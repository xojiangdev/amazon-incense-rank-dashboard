CREATE TABLE `daily_rank_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`keywordId` int NOT NULL,
	`listingId` int NOT NULL,
	`marketplace` enum('US','CA') NOT NULL,
	`snapshotDate` varchar(20) NOT NULL,
	`rank` int NOT NULL,
	`page` int NOT NULL DEFAULT 1,
	`changeFromYesterday` int DEFAULT 0,
	`isTop10` boolean NOT NULL DEFAULT false,
	`isTop50` boolean NOT NULL DEFAULT false,
	`trackedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `daily_rank_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `keywords` (
	`id` int AUTO_INCREMENT NOT NULL,
	`listingId` int NOT NULL,
	`keyword` varchar(255) NOT NULL,
	`searchVolume` int DEFAULT 0,
	`historicalConversionCount` int DEFAULT 0,
	`conversionRate` decimal(5,2) DEFAULT '0.00',
	`relevanceScore` int DEFAULT 85,
	`isCore` boolean NOT NULL DEFAULT true,
	`source` enum('ads_converting','organic_high_value','manual_selected') NOT NULL DEFAULT 'ads_converting',
	`currentRank` int DEFAULT 0,
	`previousRank` int DEFAULT 0,
	`rankChange` int DEFAULT 0,
	`bestRank` int DEFAULT 0,
	`pageNumber` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `keywords_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `listings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storeId` int NOT NULL,
	`marketplace` enum('US','CA') NOT NULL,
	`asin` varchar(20) NOT NULL,
	`parentAsin` varchar(20),
	`sku` varchar(100),
	`title` text NOT NULL,
	`category` enum('incense_sticks','incense_burner','incense_holder','other') NOT NULL,
	`categoryName` varchar(120) DEFAULT '',
	`imageUrl` text,
	`price` decimal(10,2) DEFAULT '0.00',
	`currency` varchar(10) DEFAULT 'USD',
	`inventoryStatus` enum('Active','Inactive','Out of Stock') NOT NULL DEFAULT 'Active',
	`fbaStock` int DEFAULT 0,
	`salesFollowUpStatus` enum('normal','watch','action_needed','optimizing') NOT NULL DEFAULT 'normal',
	`assignedSales` varchar(100) DEFAULT '销售组',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `listings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sales_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`listingId` int NOT NULL,
	`author` varchar(100) NOT NULL,
	`actionType` varchar(50) NOT NULL DEFAULT '销售复盘',
	`content` text NOT NULL,
	`suggestedAction` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sales_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stores` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`sellerId` varchar(64) DEFAULT '',
	`spapiRefreshToken` text,
	`adsProfileUs` varchar(64) DEFAULT '898659032586056',
	`adsProfileCa` varchar(64) DEFAULT '673034626677273',
	`syncStatus` enum('idle','syncing','success','error') NOT NULL DEFAULT 'idle',
	`lastSyncAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `stores_id` PRIMARY KEY(`id`)
);
