import { createConnection, getConnection } from 'typeorm';
import { Invoice } from '../modules/invoice/entities/invoice.entity';
import { InvoiceDetail } from '../modules/invoice/entities/invoice-detail.entity';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// 加载.env文件
const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });
console.log(`已加载环境变量文件: ${envPath}`);

const isDev = process.env.NODE_ENV === 'development';
const logFile = path.join(process.cwd(), 'logs', 'database-cleanup.log');

// 确保日志目录存在
const logDir = path.dirname(logFile);
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

function logOperation(message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(logFile, logMessage);
    console.log(message);
}

/**
 * 安全删除所有数据
 * @param batchSize 每批处理的数量
 * @returns 删除的记录数
 */
async function cleanupAllData(batchSize: number = 1000): Promise<{ invoices: number; details: number }> {
    logOperation('Starting cleanup of all data');

    const host = process.env.DB_HOST || 'localhost';
    const port = parseInt(process.env.DB_PORT || '3306', 10);
    const database = process.env.DB_DATABASE || 'einvoice';

    logOperation(`连接到数据库: ${host}:${port}/${database}`);

    let totalInvoices = 0;
    let totalDetails = 0;

    try {
        // 创建TypeORM连接
        const connection = await createConnection({
            type: 'mysql',
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '3306', 10),
            username: process.env.DB_USERNAME || 'root',
            password: process.env.DB_PASSWORD || '123456',
            database: process.env.DB_DATABASE || 'einvoice',
            entities: [Invoice, InvoiceDetail],
            synchronize: false
        });

        try {
            // 使用事务确保数据一致性
            await connection.transaction(async (manager) => {
                // 1. 先查询所有发票ID
                const invoiceIds = await manager
                    .createQueryBuilder()
                    .select('id')
                    .from(Invoice, 'invoice')
                    .getRawMany();

                const ids = invoiceIds.map(item => item.id);

                if (ids.length === 0) {
                    logOperation('No data found to delete');
                    return;
                }

                logOperation(`找到 ${ids.length} 条发票记录`);

                // 2. 分批删除发票明细
                for (let i = 0; i < ids.length; i += batchSize) {
                    const batchIds = ids.slice(i, i + batchSize);
                    const { affected: detailsAffected } = await manager
                        .createQueryBuilder()
                        .delete()
                        .from(InvoiceDetail)
                        .where('invoice_id IN (:...ids)', { ids: batchIds })
                        .execute();

                    totalDetails += detailsAffected || 0;
                    logOperation(`Deleted ${detailsAffected} invoice details in batch ${i / batchSize + 1}`);
                }

                // 3. 分批删除发票
                for (let i = 0; i < ids.length; i += batchSize) {
                    const batchIds = ids.slice(i, i + batchSize);
                    const { affected: invoicesAffected } = await manager
                        .createQueryBuilder()
                        .delete()
                        .from(Invoice)
                        .where('id IN (:...ids)', { ids: batchIds })
                        .execute();

                    totalInvoices += invoicesAffected || 0;
                    logOperation(`Deleted ${invoicesAffected} invoices in batch ${i / batchSize + 1}`);
                }
            });
        } finally {
            // 关闭连接
            await connection.close();
        }

        logOperation(`Cleanup completed. Deleted ${totalInvoices} invoices and ${totalDetails} invoice details`);
        return { invoices: totalInvoices, details: totalDetails };
    } catch (error: any) {
        logOperation(`Error during cleanup: ${error.message || String(error)}`);
        throw error;
    }
}

/**
 * 打印帮助信息
 */
function printHelp(): void {
    console.log(`
数据库清理工具 - 使用说明:

命令格式:
  node directCleanup.js [options]

参数:
  --host=HOST       数据库主机地址 (默认: ${process.env.DB_HOST || 'localhost'})
  --port=PORT       数据库端口 (默认: ${process.env.DB_PORT || '3306'})
  --user=USER       数据库用户名 (默认: ${process.env.DB_USERNAME || 'root'})
  --password=PASS   数据库密码
  --database=DB     数据库名称 (默认: ${process.env.DB_DATABASE || 'einvoice'})
  --batch=SIZE      批处理大小 (默认: 1000)
  --help            显示帮助信息

示例:
  node directCleanup.js --host=localhost --port=3306 --user=root --password=mypassword --database=einvoice

环境变量已从.env文件加载
    `);
}

/**
 * 解析命令行参数
 */
function parseArguments(): { [key: string]: string } {
    const args = process.argv.slice(2);
    const result: { [key: string]: string } = {};

    for (const arg of args) {
        if (arg === '--help') {
            result['help'] = 'true';
            continue;
        }

        if (arg.startsWith('--')) {
            const [key, value] = arg.substring(2).split('=');
            if (key && value) {
                result[key] = value;
            }
        }
    }

    return result;
}

async function bootstrap() {
    try {
        // 解析命令行参数
        const args = parseArguments();

        if (args['help']) {
            printHelp();
            return;
        }

        // 设置数据库配置参数，优先使用命令行参数，其次使用环境变量，最后使用默认值
        const dbConfig = {
            host: args['host'] || process.env.DB_HOST || 'localhost',
            port: parseInt(args['port'] || process.env.DB_PORT || '3306', 10),
            username: args['user'] || process.env.DB_USERNAME || 'root',
            password: args['password'] || process.env.DB_PASSWORD || '123456',
            database: args['database'] || process.env.DB_DATABASE || 'einvoice'
        };

        const batchSize = parseInt(args['batch'] || '1000', 10);

        console.log('执行数据清理操作...');
        console.log(`数据库连接信息: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);

        const result = await cleanupAllData(batchSize);
        console.log(`删除完成: 删除了 ${result.invoices} 张发票和 ${result.details} 条发票明细`);
    } catch (error: any) {
        console.error('删除过程中出错:', error.message || String(error));
        process.exit(1);
    }
}

bootstrap(); 