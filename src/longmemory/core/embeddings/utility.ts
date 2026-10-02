/*
 * MODIFIED by the memory-system-mvp project for Generation 2, 2026-10-02.
 * Based on LongMemory revision 9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5.
 * Adaptation: reject wrong-size and zero embedding vectors instead of resizing.
 * See ATTRIBUTION.md and UPSTREAM-LONGMEMORY-LICENSE at the repository root.
 */

/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
*   / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/
 *
 *  cavira oss (c) 2026  -  nullure (c) 2026
 *  ----------------------------------------------------------
 *  file  : src/core/embeddings/utility.ts
 *  usage : implements the LongMemory utility component
 */


export function normalize_embedding_vector(vector: unknown, dimension: number): number[] {
    if (!Array.isArray(vector) || !vector.length) throw new Error('embedding provider returned an empty vector');
    // Product adaptation: never mix spaces by padding or truncating a provider vector.
    if (vector.length !== dimension) throw new Error(`embedding dimension mismatch: expected ${dimension}, received ${vector.length}`);
    const values = vector.map(Number);
    if (values.some((value) => !Number.isFinite(value))) throw new Error('embedding provider returned a non-finite vector');
    const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
    if (norm === 0) throw new Error('embedding provider returned a zero vector');
    return values.map((value) => value / norm);
}

export async function request_json(
    fetcher: typeof fetch,
    url: string,
    init: RequestInit,
    options: { timeout_ms: number; max_retries: number; retry_base_ms: number },
): Promise<any> {
    let last: unknown;
    for (let attempt = 0; attempt <= options.max_retries; attempt++) {
        try {
            const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(options.timeout_ms) });
            if (response.ok) return response.json();
            const detail = (await response.text()).slice(0, 500);
            const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
            if (!retryable || attempt === options.max_retries) throw new Error(`${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`);
            const retry_after = Number(response.headers.get('retry-after')) * 1_000;
            await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retry_after) && retry_after > 0 ? retry_after : options.retry_base_ms * 2 ** attempt));
        } catch (error) {
            last = error;
            if (attempt === options.max_retries || !(error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError'))) throw error;
            await new Promise((resolve) => setTimeout(resolve, options.retry_base_ms * 2 ** attempt));
        }
    }
    throw last;
}
