ALTER TABLE `listings` ADD `manualSortOrder` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` ADD `salesCategory` enum('unclassified','new_product','key_product','long_tail','regular','discontinued','custom') DEFAULT 'unclassified' NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` ADD `customCategoryLabel` varchar(80);--> statement-breakpoint
ALTER TABLE `listings` ADD `salesNotes` text;