ALTER TABLE `daily_rank_snapshots` MODIFY COLUMN `marketplace` enum('US','CA','JP') NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` MODIFY COLUMN `marketplace` enum('US','CA','JP') NOT NULL;