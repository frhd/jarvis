# Deferred Services

These services were implemented but not yet integrated into the main processing flow. They are preserved here for future reference and potential reintegration.

**Removed:** 2025-12-29
**Total LOC removed:** ~14,500

---

## Category A: Never Exported (Completely Orphaned)

### backgroundResearch.service.ts
Proactive research capabilities that research topics of interest while the user continues work. Monitors conversations for research-worthy topics and schedules insight delivery.

### chaosEngineering.service.ts
Chaos engineering for testing system resilience. Supports fault injection (latency, errors, timeouts, resource, network, corruption), experiment definitions, safety controls, and recovery validation.

### distributedTracing.service.ts
Distributed tracing for tracking requests across services. Supports trace and span management, context propagation, timing, and error recording.

### enhancedAlerting.service.ts
Advanced alerting with rule definitions (threshold, anomaly, rate), multiple severity levels with escalation, alert channels (log, webhook), deduplication/grouping, and escalation policies.

### insightScheduling.service.ts
Scheduled insights with timing strategies (next_relevant_conversation, weekly_digest, daily_summary, immediate) and presentation styles.

### intelligentAutomation.service.ts
Detects repeated patterns in user behavior and auto-generates automation scripts. Includes pattern detection, value estimation, script generation, sandbox testing, and user proposals.

### offlineQueue.service.ts
Server-side tracking of offline message queues. Queues messages when client is offline, syncs on reconnection, implements conflict resolution strategies.

### opportunityDetection.service.ts
Detects opportunities across categories (code optimization, learning, connections, automation, creative). Identifies gaps and suggests improvements.

### proactiveProblemPrevention.service.ts
Proactive problem prevention by scanning for potential risks (technical, project, personal) before they become actual problems.

### rateLimiting.service.ts
Rate limiting with multiple algorithms (sliding-window, token-bucket, fixed-window, leaky-bucket) and per-user/per-provider limiting.

---

## Category B: Exported but Never Used

### challengeMode.service.ts
"Devil's Advocate" functionality that pushes users to think deeper. Identifies assumptions, generates counterarguments, finds edge cases, asks Socratic questions, presents alternative perspectives.

### dreamTeamSimulation.service.ts
Simulates expert code reviews with multiple personas: code_reviewer, architect, product_thinker, debugger, optimizer, ux_expert, security_expert.

### secondBrainExport.service.ts
Exports the AI's mental model of the user for review. Allows users to see what Jarvis has learned, correct misunderstandings, and provide feedback.

### contextPreloading.service.ts
Pre-loads context based on user patterns and time of day. Handles predictive context loading for anticipated user intents.

### proactiveResearch.service.ts
Conducts background research on topics of interest. Integrates with ContextGraphService, LLMClient, and MemoryService.

### relationshipDynamics.service.ts
Models user-Jarvis relationship evolution. Tracks trust, collaboration preferences, and relationship phases.

### conversationLearning.service.ts
Learns from interactions to improve responses. Integrates with IntentLogRepository, MemoryRepository, and LLMResponseRepository.

### continuousImprovement.service.ts
Orchestrates the improvement lifecycle. Integrates with ConversationLearningService and RelationshipDynamicsService.

### crossDomainPatternRecognition.service.ts
Finds analogies across domains. Enables pattern recognition from one domain to apply to another.

---

## Reintegration Notes

To reintegrate any of these services:

1. Restore the service file from git history:
   ```bash
   git show HEAD~1:src/services/<service-name>.ts > src/services/<service-name>.ts
   ```

2. Add export to `src/services/index.ts`

3. Wire into the appropriate handler or processing flow (likely `processor.service.ts` or `responseRouter.service.ts`)

4. Add feature flag in `src/config/feature-flags.ts`

5. Update CLAUDE.md with integration points
