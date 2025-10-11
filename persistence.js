// ============================================================
// V2.0 Phase 5: Persistent Storage Module
// ============================================================
// Handles saving and loading trading state to/from JSON files
// Supports schema versioning and data migration
// ============================================================

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Storage paths
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'trading-state.json');
const BACKUP_FILE = path.join(DATA_DIR, 'trading-state.backup.json');
const HISTORY_DIR = path.join(DATA_DIR, 'history');

// Current schema version
const SCHEMA_VERSION = '2.0.0';

/**
 * Initialize data directory structure
 */
export async function initStorage() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        await fs.mkdir(HISTORY_DIR, { recursive: true });
        console.log('✅ Storage directories initialized');
    } catch (err) {
        console.error('❌ Failed to initialize storage:', err);
        throw err;
    }
}

/**
 * Save current trading state to disk
 * @param {Object} state - Complete trading state
 * @returns {Promise<boolean>} Success status
 */
export async function saveState(state) {
    try {
        // Add metadata
        const dataToSave = {
            version: SCHEMA_VERSION,
            timestamp: new Date().toISOString(),
            serverSessionId: state.serverSessionId,
            tradingMode: state.tradingMode,
            wallet: state.wallet,
            selectedMarkets: state.selectedMarkets,
            assets: state.assets,
            tradingConfig: state.tradingConfig,
            // V2.0 Phase 5: Additional state data
            checkLoopStarted: state.checkLoopStarted || false,
            currentLastPrices: state.currentLastPrices || []
        };

        const json = JSON.stringify(dataToSave, null, 2);

        // Create backup of existing file
        try {
            await fs.access(STATE_FILE);
            await fs.copyFile(STATE_FILE, BACKUP_FILE);
        } catch {
            // No existing file, skip backup
        }

        // Write new state
        await fs.writeFile(STATE_FILE, json, 'utf8');

        return true;
    } catch (err) {
        console.error('❌ Failed to save state:', err);
        return false;
    }
}

/**
 * Load trading state from disk
 * @returns {Promise<Object|null>} Loaded state or null if not found
 */
export async function loadState() {
    try {
        const data = await fs.readFile(STATE_FILE, 'utf8');
        const parsed = JSON.parse(data);

        // Validate schema version
        if (parsed.version !== SCHEMA_VERSION) {
            console.log(`⚠️  Schema version mismatch: ${parsed.version} !== ${SCHEMA_VERSION}`);
            console.log('   Attempting migration...');
            const migrated = await migrateState(parsed);
            if (migrated) {
                return migrated;
            } else {
                console.log('   Migration failed, using current version');
                return null;
            }
        }

        console.log(`✅ Loaded state from ${new Date(parsed.timestamp).toLocaleString()}`);
        return parsed;
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log('ℹ️  No saved state found, starting fresh');
            return null;
        }
        console.error('❌ Failed to load state:', err);

        // Try backup
        try {
            console.log('   Attempting to load from backup...');
            const backupData = await fs.readFile(BACKUP_FILE, 'utf8');
            const parsed = JSON.parse(backupData);
            console.log('✅ Loaded state from backup');
            return parsed;
        } catch (backupErr) {
            console.error('❌ Backup also failed:', backupErr);
            return null;
        }
    }
}

/**
 * Migrate state from older schema version
 * @param {Object} oldState - State with older schema
 * @returns {Promise<Object|null>} Migrated state or null if failed
 */
async function migrateState(oldState) {
    try {
        // For now, just update version and keep data
        // Future: Add migration logic for breaking changes
        const migrated = {
            ...oldState,
            version: SCHEMA_VERSION,
            timestamp: new Date().toISOString()
        };

        // Save migrated state
        await fs.writeFile(STATE_FILE, JSON.stringify(migrated, null, 2), 'utf8');
        console.log('✅ State migrated successfully');

        return migrated;
    } catch (err) {
        console.error('❌ Migration failed:', err);
        return null;
    }
}

/**
 * Archive current state to history
 * Creates timestamped snapshot
 */
export async function archiveState() {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const archiveFile = path.join(HISTORY_DIR, `state-${timestamp}.json`);

        await fs.copyFile(STATE_FILE, archiveFile);
        console.log(`📦 State archived to ${path.basename(archiveFile)}`);

        // Cleanup old archives (keep last 10)
        await cleanupArchives();
    } catch (err) {
        console.error('❌ Failed to archive state:', err);
    }
}

/**
 * Remove old archive files, keep only recent ones
 */
async function cleanupArchives() {
    try {
        const files = await fs.readdir(HISTORY_DIR);
        const stateFiles = files
            .filter(f => f.startsWith('state-') && f.endsWith('.json'))
            .sort()
            .reverse(); // Newest first

        // Keep only last 10 archives
        const MAX_ARCHIVES = 10;
        if (stateFiles.length > MAX_ARCHIVES) {
            const toDelete = stateFiles.slice(MAX_ARCHIVES);
            for (const file of toDelete) {
                await fs.unlink(path.join(HISTORY_DIR, file));
            }
            console.log(`🗑️  Cleaned up ${toDelete.length} old archives`);
        }
    } catch (err) {
        console.error('❌ Failed to cleanup archives:', err);
    }
}

/**
 * Clear all saved state (for reset)
 */
export async function clearState() {
    try {
        await fs.unlink(STATE_FILE);
        await fs.unlink(BACKUP_FILE);
        console.log('🗑️  Cleared all saved state');
        return true;
    } catch (err) {
        if (err.code === 'ENOENT') {
            // Files don't exist, that's fine
            return true;
        }
        console.error('❌ Failed to clear state:', err);
        return false;
    }
}

export default {
    initStorage,
    saveState,
    loadState,
    archiveState,
    clearState
};
