import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class AuthorizationCacheService {
    private readonly logger = new Logger(AuthorizationCacheService.name);

    // Cache to store authorization by orderNo for callback processing
    private readonly authorizationCache = new Map<string, { authorization: string; tenantId: string; timestamp: number }>();

    // Cache cleanup interval (24 hours)
    private readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    constructor() {
        // Clean up expired cache entries every hour
        setInterval(() => {
            this.cleanupExpiredCache();
        }, 60 * 60 * 1000); // 1 hour
    }

    /**
     * Clean up expired cache entries
     */
    private cleanupExpiredCache(): void {
        const now = Date.now();
        for (const [orderNo, entry] of this.authorizationCache.entries()) {
            if (now - entry.timestamp > this.CACHE_TTL) {
                this.authorizationCache.delete(orderNo);
                this.logger.log(`Cleaned up expired cache entry for orderNo: ${orderNo}`);
            }
        }
    }

    /**
     * Store authorization for callback processing
     */
    storeAuthorizationForCallback(orderNo: string, authorization: string, tenantId: string): void {
        this.authorizationCache.set(orderNo, {
            authorization,
            tenantId,
            timestamp: Date.now()
        });
        this.logger.log(`Stored authorization for orderNo: ${orderNo}, tenantId: ${tenantId}`);

        // Debug: Log cache size after storing
        this.logger.log(`Authorization cache size after storing: ${this.authorizationCache.size}`);
    }

    /**
     * Retrieve authorization for callback processing
     */
    getAuthorizationForCallback(orderNo: string): { authorization: string; tenantId: string } | null {
        const entry = this.authorizationCache.get(orderNo);
        if (!entry) {
            this.logger.warn(`No authorization found in cache for orderNo: ${orderNo}`);
            return null;
        }

        // Check if entry is expired
        if (Date.now() - entry.timestamp > this.CACHE_TTL) {
            this.authorizationCache.delete(orderNo);
            this.logger.warn(`Authorization cache entry expired for orderNo: ${orderNo}`);
            return null;
        }

        this.logger.log(`Retrieved authorization for orderNo: ${orderNo}, tenantId: ${entry.tenantId}`);
        return {
            authorization: entry.authorization,
            tenantId: entry.tenantId
        };
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { totalEntries: number; oldestEntry: Date | null; newestEntry: Date | null } {
        const entries = Array.from(this.authorizationCache.values());

        if (entries.length === 0) {
            return {
                totalEntries: 0,
                oldestEntry: null,
                newestEntry: null
            };
        }

        const timestamps = entries.map(entry => entry.timestamp);
        const oldestTimestamp = Math.min(...timestamps);
        const newestTimestamp = Math.max(...timestamps);

        return {
            totalEntries: entries.length,
            oldestEntry: new Date(oldestTimestamp),
            newestEntry: new Date(newestTimestamp)
        };
    }

    /**
     * Clear cache
     */
    clearCache(): { clearedEntries: number } {
        const entriesCount = this.authorizationCache.size;
        this.authorizationCache.clear();
        this.logger.log(`Manually cleared ${entriesCount} authorization cache entries`);

        return { clearedEntries: entriesCount };
    }

    /**
     * Get the authorization cache (for debugging purposes)
     */
    getAuthorizationCache(): Map<string, { authorization: string; tenantId: string; timestamp: number }> {
        return this.authorizationCache;
    }

    /**
     * Clear authorization cache (alias for clearCache)
     */
    clearAuthorizationCache(): void {
        this.clearCache();
    }
} 