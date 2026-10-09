-- Migration: adds the pickup_schedules table for the recurring schedules feature.
-- Safe to run against an existing database — does NOT drop anything.

USE cleantrack_uganda;

CREATE TABLE IF NOT EXISTS pickup_schedules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  location_id INT NOT NULL,
  waste_category_id INT NOT NULL,
  day_of_week ENUM('monday','tuesday','wednesday','thursday','friday','saturday','sunday') NOT NULL,
  estimated_bin_level INT NOT NULL,
  note TEXT,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  reviewed_by INT,
  reviewed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES customer_locations(id) ON DELETE CASCADE,
  FOREIGN KEY (waste_category_id) REFERENCES waste_categories(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);