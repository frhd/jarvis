# Performance Benchmarks

This directory contains performance benchmarking tests for the memory and RAG systems.

## Running Benchmarks

```bash
# Run all performance benchmarks
npx tsx tests/performance/memory-benchmarks.test.ts

# Or make it executable first
chmod +x tests/performance/memory-benchmarks.test.ts
./tests/performance/memory-benchmarks.test.ts
```

## Benchmark Coverage

### Memory Retrieval Performance

Tests memory retrieval speed at different dataset sizes:

- **10 memories**: Target < 50ms (p95)
- **100 memories**: Target < 100ms (p95)
- **1000 memories**: Target < 500ms (p95)

### Embedding Similarity Search

Tests vector similarity search performance:

- **100 embeddings**: Target < 100ms (p95)
- **1000 embeddings**: Target < 300ms (p95)

### Context Assembly

Tests RAG context building speed:

- **Small context (10 items)**: Target < 20ms (p95)
- **Large context (100 items)**: Target < 50ms (p95)

### Token Estimation

Tests token counting accuracy and speed:

- Target < 1ms per estimation (p95)
- Tests various text lengths (10, 61, 610, 1000 chars)

### End-to-End Performance

Tests complete context building pipeline:

- **100 memories + 20 messages**: Target < 200ms (p95)
- Includes embedding generation, similarity search, and context assembly

### Additional Metrics

- **Embedding Generation**: Measures single embedding generation speed
- **Duplicate Detection**: Tests performance of duplicate memory detection

## Understanding Results

Each benchmark reports:

- **Iterations**: Number of test runs
- **Average**: Mean execution time
- **Min/Max**: Fastest and slowest runs
- **p50**: Median (50th percentile)
- **p95**: 95th percentile (acceptable for most cases)
- **p99**: 99th percentile (worst case excluding outliers)
- **Threshold**: Maximum acceptable time (p95)
- **Status**: PASS/FAIL based on threshold

## Performance Thresholds

Thresholds are defined in `memory-benchmarks.test.ts`:

```typescript
const THRESHOLDS = {
  MEMORY_RETRIEVAL_10: 50,      // < 50ms for 10 memories
  MEMORY_RETRIEVAL_100: 100,    // < 100ms for 100 memories
  MEMORY_RETRIEVAL_1000: 500,   // < 500ms for 1000 memories
  EMBEDDING_SEARCH_100: 100,    // < 100ms for searching 100 embeddings
  EMBEDDING_SEARCH_1000: 300,   // < 300ms for searching 1000 embeddings
  CONTEXT_ASSEMBLY_SMALL: 20,   // < 20ms for small context (10 items)
  CONTEXT_ASSEMBLY_LARGE: 50,   // < 50ms for large context (100 items)
  TOKEN_ESTIMATION: 1,          // < 1ms per estimation
  END_TO_END_BUILD: 200,        // < 200ms for complete context build
};
```

## Mock Implementation

The benchmarks use mocked external services:

- **MockLLMClient**: Returns dummy LLM responses
- **MockEmbeddingClient**: Generates deterministic embeddings using sine function
- **MockMemoryRepository**: In-memory storage for memories
- **MockEmbeddingRepository**: In-memory storage with cosine similarity search
- **MockMessageRepository**: In-memory message storage

This ensures:
- Fast, repeatable tests
- No external dependencies (no Ollama required)
- Consistent performance measurements

## Interpreting Results

### Good Performance (PASS)

```
✓ PASS Memory Retrieval (100 memories)
  p95:        45.23ms
  Threshold:  < 100ms
  Status:     PASSED
```

The 95th percentile is well below the threshold.

### Poor Performance (FAIL)

```
✗ FAIL Memory Retrieval (1000 memories)
  p95:        650.12ms
  Threshold:  < 500ms
  Status:     FAILED
```

The 95th percentile exceeds the threshold, indicating performance issues.

## Troubleshooting

If benchmarks fail:

1. **Check system load**: Close other applications
2. **Review thresholds**: May need adjustment for different hardware
3. **Profile slow operations**: Add timing logs to identify bottlenecks
4. **Optimize queries**: Review database queries and indexes
5. **Consider caching**: Add caching for frequently accessed data

## Future Improvements

Potential additions:

- Benchmark memory extraction performance
- Test conversation summarization speed
- Measure RAG pipeline throughput (requests/second)
- Add memory usage profiling
- Test concurrent request handling
- Benchmark different embedding models
