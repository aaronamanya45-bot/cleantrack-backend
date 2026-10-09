const pool = require("../config/db");

const VALID_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

// Customer creates a new weekly pickup schedule.
const createSchedule = async (req, res) => {
  try {
    const { location_id, waste_category_id, day_of_week, estimated_bin_level, note } = req.body;

    if (!location_id || !waste_category_id || !day_of_week || !estimated_bin_level) {
      return res.status(400).json({
        message: "Location, waste type, day of week, and bin level are required"
      });
    }

    if (!VALID_DAYS.includes(String(day_of_week).toLowerCase())) {
      return res.status(400).json({
        message: `day_of_week must be one of: ${VALID_DAYS.join(", ")}`
      });
    }

    const level = Number(estimated_bin_level);
    if (Number.isNaN(level) || level < 1 || level > 100) {
      return res.status(400).json({ message: "estimated_bin_level must be between 1 and 100" });
    }

    // Ownership check: customer can only schedule pickups for their own locations.
    const [locations] = await pool.query(
      "SELECT id FROM customer_locations WHERE id = ? AND user_id = ?",
      [location_id, req.user.id]
    );
    if (!locations.length) {
      return res.status(403).json({ message: "You can only create schedules for your own locations" });
    }

    const [result] = await pool.query(
      `INSERT INTO pickup_schedules
         (customer_id, location_id, waste_category_id, day_of_week, estimated_bin_level, note, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [req.user.id, location_id, waste_category_id, day_of_week.toLowerCase(), level, note || null]
    );

    res.status(201).json({ message: "Schedule created", id: result.insertId });
  } catch (error) {
    res.status(500).json({ message: "Could not create schedule", error: error.message });
  }
};

// Customer lists their own schedules.
const getMySchedules = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ps.*, cl.location_name, cl.district, wc.name AS waste_type
       FROM pickup_schedules ps
       JOIN customer_locations cl ON cl.id = ps.location_id
       JOIN waste_categories wc ON wc.id = ps.waste_category_id
       WHERE ps.customer_id = ?
       ORDER BY FIELD(ps.day_of_week,
         'monday','tuesday','wednesday','thursday','friday','saturday','sunday'), ps.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Could not load schedules", error: error.message });
  }
};

// Customer cancels (deletes) their own pending schedule.
const deleteSchedule = async (req, res) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM pickup_schedules WHERE id = ? AND customer_id = ? AND status = 'pending'",
      [req.params.id, req.user.id]
    );
    if (!result.affectedRows) {
      return res.status(400).json({ message: "Only your pending schedules can be cancelled" });
    }
    res.json({ message: "Schedule cancelled" });
  } catch (error) {
    res.status(500).json({ message: "Could not cancel schedule", error: error.message });
  }
};

// Admin lists schedules filtered by status (pending by default).
const getSchedulesByStatus = async (req, res) => {
  try {
    const status = req.query.status || "pending";
    const allowed = ["pending", "approved", "rejected"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: "status must be pending, approved, or rejected" });
    }

    const [rows] = await pool.query(
      `SELECT ps.*, u.full_name AS customer_name, u.email AS customer_email,
              cl.location_name, cl.district, wc.name AS waste_type
       FROM pickup_schedules ps
       JOIN users u ON u.id = ps.customer_id
       JOIN customer_locations cl ON cl.id = ps.location_id
       JOIN waste_categories wc ON wc.id = ps.waste_category_id
       WHERE ps.status = ?
       ORDER BY ps.created_at ASC`,
      [status]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Could not load schedules", error: error.message });
  }
};

// Admin approves or rejects a schedule.
const updateScheduleStatus = async (req, res) => {
  try {
    const { status, admin_note } = req.body;
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ message: "status must be approved or rejected" });
    }

    const [result] = await pool.query(
      `UPDATE pickup_schedules
       SET status = ?, admin_note = ?, reviewed_by = ?, reviewed_at = NOW()
       WHERE id = ? AND status = 'pending'`,
      [status, admin_note || null, req.user.id, req.params.id]
    );

    if (!result.affectedRows) {
      return res.status(400).json({ message: "Schedule not found or already reviewed" });
    }

    res.json({ message: `Schedule ${status}` });
  } catch (error) {
    res.status(500).json({ message: "Could not update schedule", error: error.message });
  }
};

// Admin triggers generation of pickup_requests for every approved schedule
// whose day_of_week matches today. Skips duplicates created today.
const generatePickupsFromSchedules = async (req, res) => {
  try {
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const today = days[new Date().getDay()];

    const [schedules] = await pool.query(
      "SELECT * FROM pickup_schedules WHERE status = 'approved' AND day_of_week = ?",
      [today]
    );

    if (!schedules.length) {
      return res.json({ message: `No approved schedules for ${today}`, created: 0, skipped: 0 });
    }

    let created = 0;
    let skipped = 0;

    for (const s of schedules) {
      // Skip if a pickup was already generated for this schedule today.
      const [existing] = await pool.query(
        `SELECT id FROM pickup_requests
         WHERE customer_id = ? AND location_id = ? AND waste_category_id = ?
           AND DATE(created_at) = CURDATE()`,
        [s.customer_id, s.location_id, s.waste_category_id]
      );

      if (existing.length) {
        skipped += 1;
        continue;
      }

      await pool.query(
        `INSERT INTO pickup_requests
           (customer_id, location_id, waste_category_id, description, urgency, estimated_bin_level, status)
         VALUES (?, ?, ?, ?, 'normal', ?, 'pending')`,
        [
          s.customer_id,
          s.location_id,
          s.waste_category_id,
          `Auto-generated from weekly schedule (${s.day_of_week})${s.note ? " — " + s.note : ""}`,
          s.estimated_bin_level
        ]
      );
      created += 1;
    }

    res.json({
      message: `Generated ${created} pickup request(s) for ${today}; skipped ${skipped} duplicate(s)`,
      created,
      skipped
    });
  } catch (error) {
    res.status(500).json({ message: "Could not generate pickups", error: error.message });
  }
};

module.exports = {
  createSchedule,
  getMySchedules,
  deleteSchedule,
  getSchedulesByStatus,
  updateScheduleStatus,
  generatePickupsFromSchedules
};