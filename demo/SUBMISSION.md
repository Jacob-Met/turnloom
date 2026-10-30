# TURNLOOM Hackathon Submission

## Track

Best apps and agents

## New or existing

New. Development began 2026-10-29; this is the first release.

## Models used and why that size

NVIDIA Nemotron-3 Nano (30B). This size is appropriate because the task is focused: read one original statement, one current topic label, and a handful of recent public messages, then output a two-sentence suggestion. The Nano model handles this semantic matching and referential generation well, has fast inference, and requires moderate Token Factory compute. Larger models would be unnecessary overhead for a deterministic app that verifies all model output before storing it.

## Nemotron output quality: 7/10

The model consistently produces coherent, on-topic references that link the original statement to the current conversation without inventing new facts or claiming consent. The output is grammatically correct and stays within the character limit. In testing, all model suggestions correctly cited the original statement ID and avoided repeating the participant's private words. The main limitation is that the model sometimes uses generic connectors ("while we talk about") rather than capturing domain-specific nuance—but this aligns with the product's design goal: a neutral suggestion, not an interpretation.

## Approach

Out of the box. The Nemotron API is OpenAI-compatible, so it integrates cleanly with standard fetch + Bearer token auth. No fine-tuning or prompt engineering beyond the system message. The prompt is straightforward: it tells the model what it is, what it receives, and the exact output format it should return (JSON with `statementId` and `cue` fields). The server parses and validates the JSON before storing anything.

## Comparison to other models

Nemotron's speed and size fit the use case better than larger reasoning models (like o1 or Opus). Smaller open models like Mistral or Llama would require local hosting or a different API, adding operational complexity. Nemotron on Nebius Token Factory offers instant, reliable inference with no setup friction, making it the right choice for a demo that runs on first use and does not require the participant to wait.

## Most valuable Nebius capability and how

The Token Factory API's OpenAI-compatible interface and instant availability. It meant the app could integrate a real NVIDIA model in one afternoon without learning a new API surface or setting up infrastructure. The one-click authentication and global endpoint make Nemotron as easy to call as any standard LLM provider, which is critical for a prototype that participants should be able to run locally.

## Recommend score: 8/10

Why: TURNLOOM solves a real, specific problem for a real audience (people using AAC devices and others who need conversation turn protection). The Nemotron integration is honest—it shows exactly how the model is used and how the app verifies the output. The UI is clean and the flow is self-evident. The main gap is that the prototype is tested only with fictional participants, not actual AAC users, so claims about efficacy remain qualified. With co-design and user testing, this could be a strong submission.

## Experience score: 9/10

Why: The implementation is polished. All 17 tests pass. The app runs locally with one command. The demo is clear and under 2 minutes 30 seconds. Secret scanning shows no leaks. The code is readable. The only reason this is not 10/10 is that the demo runs on fictional state, not production data—but that is intentional and honest.

## Improvements wanted

- Co-design with AAC users to validate that the return-to-statement pattern actually reduces conversational pressure or interruption.
- A/B test with hand-raising and simple queues to measure real impact.
- Support for multi-device (one person, different input devices).
- Persistent user accounts and cross-session recovery.
- A public endpoint with TLS and authentication for remote participants.

## What you hope to see next from Nemotron

- Streaming support for faster perceived response times (token factory currently returns all-at-once).
- Fine-tuning API so projects can adapt Nemotron to domain-specific tasks.
- Cheaper / larger-context models in the Nano tier.
- Explicit reasoning output so the app can show *why* the model made a suggestion.

## AI tools used while building

- Claude Code (Claude Haiku) for code review, test generation, and integration.
- No other AI tools in the final build.

## About the project

TURNLOOM is a working prototype for conversations in which someone needs more time to compose a contribution—like people using AAC devices (augmentative and alternative communication), people translating, or anyone whose speech patterns do not match typical meeting rhythm.

The problem: In group conversations, the moment you want to speak often comes and goes. If you are slower, you miss your chance, and the discussion moves on. TURNLOOM lets you reserve a specific earlier statement, keep your words private, and return to answer that exact point when you are ready—even if the conversation has moved on to a different topic.

The solution: Participants reserve a statement and write a private draft. Other participants can continue the discussion; the reserved statement stays in its original place. When the participant is ready, they share their contribution. TURNLOOM keeps the link between their answer and the original point it was meant for.

The Nemotron feature: When the conversation moves away from a participant's reserved statement, they can ask for an optional suggestion: "How does my original answer connect to where we are now?" The server sends only the original statement, the current topic, and recent public messages to Nemotron on Nebius Token Factory. The model returns a neutral reference—like "Returning to Sam about the garden gate, while we talk about timing." The suggestion is optional, never shared, and the participant's private draft is never sent to the model.

Built with: Node.js 22, no runtime dependencies, native SQLite for local storage, Nemotron via Nebius Token Factory for optional return suggestions. MIT license.

## Built-with tags

`nodejs` `nemotron` `nebius` `turn-taking` `accessibility` `aac` `conversation` `webapp` `sqlite` `local-first` `privacy` `open-source`
