const express = require("express");
const {
  createSchedule,
  getMySchedules,
  deleteSchedule,
  getSchedulesByStatus,
  updateScheduleStatus,
  generatePickupsFromSchedules
} = require("../controllers/scheduleController");
const { protect } = require("../middleware/authMiddleware");
const { allowRoles } = require("../middleware/roleMiddleware");

const router = express.Router();

// ---- Customer routes ----
// Create a weekly pickup schedule for one of the customer's own locations.
router.post("/", protect, allowRoles("customer"), createSchedule);

// List the logged-in customer's own schedules.
router.get("/my-schedules", protect, allowRoles("customer"), getMySchedules);

// Cancel (delete) a pending schedule that belongs to the customer.
router.delete("/:id", protect, allowRoles("customer"), deleteSchedule);

// ---- Admin routes ----
// Admin lists schedules filtered by status (?status=pending|approved|rejected).
router.get("/admin/list", protect, allowRoles("admin"), getSchedulesByStatus);

// Admin approves or rejects a schedule.
router.put("/admin/:id/status", protect, allowRoles("admin"), updateScheduleStatus);

// Admin triggers generation of this week's pickup requests from approved schedules.
router.post("/admin/generate-pickups", protect, allowRoles("admin"), generatePickupsFromSchedules);

module.exports = router;