import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DatabaseCleanupService } from '../modules/database/database-cleanup.service';
import { Logger } from '@nestjs/common';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule);
    const cleanupService = app.get(DatabaseCleanupService);
    const logger = new Logger('CleanupScript');

    try {
        // 解析命令行参数
        const args = process.argv.slice(2);
        const command = args[0];
        const param = args[1];

        if (!command) {
            logger.error('Please specify a cleanup command: date, status, or all');
            process.exit(1);
        }

        switch (command) {
            case 'date':
                if (!param) {
                    logger.error('Please specify a date in ISO format (e.g., 2023-01-01)');
                    process.exit(1);
                }
                const beforeDate = new Date(param);
                if (isNaN(beforeDate.getTime())) {
                    logger.error('Invalid date format. Please use ISO format (e.g., 2023-01-01)');
                    process.exit(1);
                }
                const dateResult = await cleanupService.cleanupDataBeforeDate(beforeDate);
                logger.log(`Deleted ${dateResult.invoices} invoices and ${dateResult.details} invoice details before ${param}`);
                break;

            case 'status':
                if (!param) {
                    logger.error('Please specify a status to delete');
                    process.exit(1);
                }
                const statusResult = await cleanupService.cleanupDataByStatus(param);
                logger.log(`Deleted ${statusResult.invoices} invoices and ${statusResult.details} invoice details with status ${param}`);
                break;

            case 'all':
                const allResult = await cleanupService.cleanupAllData();
                logger.log(`Deleted all data: ${allResult.invoices} invoices and ${allResult.details} invoice details`);
                break;

            default:
                logger.error('Unknown command. Use either "date", "status", or "all"');
                process.exit(1);
        }
    } catch (error) {
        logger.error('Error during cleanup:', error);
        process.exit(1);
    } finally {
        await app.close();
    }
}

bootstrap(); 