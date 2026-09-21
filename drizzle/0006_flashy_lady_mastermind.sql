ALTER TABLE `listings` ADD `fbaInboundWorking` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` ADD `fbaInboundShipped` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` ADD `fbaInboundReceiving` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` ADD `fbaInboundTotal` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` ADD `reviewRating` decimal(3,2);--> statement-breakpoint
ALTER TABLE `listings` ADD `reviewCount` int;--> statement-breakpoint
ALTER TABLE `listings` ADD `reviewMetricsSource` varchar(40);--> statement-breakpoint
ALTER TABLE `listings` ADD `reviewMetricsUpdatedAt` timestamp;