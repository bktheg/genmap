import * as fs from 'fs';
import * as path from 'path';

// Vector tiles are fully determined by the generated map data, which only
// changes on a generation run (generate/map/generate-info). We therefore cache
// each rendered MVT tile in memory and on disk and invalidate everything via a
// small generation-token file so the (separately running) preview process can
// notice a regeneration cross-process.

const katasterPath = process.env.KATASTER_PATH
const cacheRoot = path.join(katasterPath || '.', 'tilecache')
const tokenFile = path.join(cacheRoot, 'generation.txt')

const MEM_CACHE_LIMIT = 4000
const TOKEN_CHECK_INTERVAL_MS = 1000

const memCache = new Map<string, Buffer>()
let activeToken: string = null
let lastTokenCheck = 0

function readToken(): string {
    try {
        return fs.readFileSync(tokenFile, 'utf8').trim() || 'initial'
    } catch (err) {
        // No generation marker yet -> treat as a stable initial generation.
        return 'initial'
    }
}

// Returns the current generation token, refreshing at most once per interval.
// When the token changed (a regeneration happened, possibly in another process)
// the in-memory cache is dropped so stale tiles are not served.
function currentToken(): string {
    const now = Date.now()
    if (activeToken !== null && now - lastTokenCheck < TOKEN_CHECK_INTERVAL_MS) {
        return activeToken
    }
    lastTokenCheck = now
    const token = readToken()
    if (token !== activeToken) {
        memCache.clear()
        activeToken = token
    }
    return activeToken
}

function memKey(token: string, z: number, x: number, y: number): string {
    return `${token}/${z}/${x}/${y}`
}

function tilePath(token: string, z: number, x: number, y: number): string {
    return path.join(cacheRoot, token, String(z), String(x), `${y}.mvt`)
}

function putMem(key: string, data: Buffer): void {
    if (memCache.size >= MEM_CACHE_LIMIT) {
        const oldest = memCache.keys().next().value
        if (oldest !== undefined) {
            memCache.delete(oldest)
        }
    }
    memCache.set(key, data)
}

// A zero-length Buffer is a valid (empty) cached tile; null means "not cached".
export function get(z: number, x: number, y: number): Buffer | null {
    const token = currentToken()
    const key = memKey(token, z, x, y)
    const mem = memCache.get(key)
    if (mem !== undefined) {
        return mem
    }
    try {
        const buf = fs.readFileSync(tilePath(token, z, x, y))
        putMem(key, buf)
        return buf
    } catch (err) {
        return null
    }
}

export function put(z: number, x: number, y: number, data: Buffer): void {
    const token = currentToken()
    putMem(memKey(token, z, x, y), data)
    const file = tilePath(token, z, x, y)
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, data)
    } catch (err) {
        // Disk cache is best-effort; a failed write just means future misses.
    }
}

// Marks the cached tiles as stale. Called by data-generation commands so the
// preview server rebuilds tiles from the freshly generated data.
export function invalidate(): void {
    const token = String(Date.now())
    try {
        fs.mkdirSync(cacheRoot, { recursive: true })
        fs.writeFileSync(tokenFile, token)
    } catch (err) {
        // If we cannot write the token the preview server keeps its old cache;
        // nothing we can safely do about it here.
    }
    try {
        for (const entry of fs.readdirSync(cacheRoot)) {
            if (entry === 'generation.txt' || entry === token) {
                continue
            }
            fs.rmSync(path.join(cacheRoot, entry), { recursive: true, force: true })
        }
    } catch (err) {
        // Best-effort cleanup of stale token directories.
    }
    memCache.clear()
    activeToken = null
}
