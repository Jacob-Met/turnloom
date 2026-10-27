# TURNLOOM

Keep your contribution connected to its intended point.

TURNLOOM is a working prototype for conversations in which someone needs more time to compose a contribution. Reserve a specific statement, keep your words private, and return to that point when you choose. Other participants can continue the discussion.

## Run locally

Use Node.js 22 or later. The application has no runtime package dependencies.

```sh
node server.mjs
```

Open the local address printed by the server (normally http://127.0.0.1:4177). To choose a different port or data directory:

```sh
node server.mjs --port 0 --data-dir "/path/to/turnloom-data"
```

The server binds to the local computer. This version does not set up a public endpoint, TLS or a remote account.

## Try the complete conversation

Start the **fictional four-person demo** about choosing a place for a reading circle. The creator receives one invitation per fictional participant. Each invitation binds to one participant session. The browser retains its randomly generated session key before accepting the invitation; an interrupted response can be recovered by reloading or retrying that same entry. A different session cannot reuse an accepted invitation. After joining, the participant session stays in that browser tab's session storage.

For a genuine separation test, open the four invitations in separate browser profiles or isolated browser contexts on this computer. A person holding all four invitations can act as all four fictional participants; the demo is not private from that creator or the computer's operator.

1. As Mira, reserve Sam's statement about the garden gate. Choose the purpose of your contribution and write a private draft.
2. As another participant, move the discussion to when the group will meet and add a new statement.
3. Mira's reservation remains attached to the exact earlier statement. Save the draft, then explicitly mark it ready.
4. Bring back the original point. This shares a neutral reference to the earlier statement, not Mira's private words.
5. Review the exact draft and choose to share it. The contribution retains its link to the original point.

Editing a ready draft makes it unready. Withdrawing closes that reservation while retaining its saved words privately. An old request cannot publish a newer draft or revive a withdrawn reservation. Ready does not mean permission for anyone else to speak or share on the participant's behalf.

## Words, data and control

There is no microphone capture, audio transcription or automatic speech. Manual statements and topic selection are the complete available path.

Private drafts are excluded from other participant views, shared exports and the model input projection. They are saved as local application data on this server; this is not encryption from the computer's operator. Invitations and session capabilities are stored as hashes. Newly created data directories use mode 0700 and snapshot files use mode 0600; pre-existing directory permissions are retained. Keep participant links private.

The default data directory is `.turnloom`. Restart the server with the same directory to reopen saved state. Do not start two writers on one directory. The server refuses an existing writer lock. After a crash, inspect its recorded process and remove only the stale `writer.lock` after verifying that process is no longer running.

The shared conversation export contains approved statements, reservation statuses and their original anchors. It does not contain unfinished drafts or participant access links. Keep the entire data directory if you need to preserve private local work; do not distribute it with an application build.

## Current proof boundary

The initial scenario and all four participants are authored fiction. Automated participants can test privacy, state transitions and topic links; they cannot establish that this helps AAC users or reduces conversational pressure.

Actual co-design with AAC users, comparison against hand raising and a simple queue, switch-device receiving, and assessment of intended-topic arrival, unwanted interruptions, control and pressure remain necessary. Do not interpret the prototype as an efficacy claim or a validated assistive communication device.

An actual NVIDIA model on an authorized Nebius runtime is a separate open dependency. No provider inference is simulated or claimed. The model boundary is intended to receive only approved public conversation and offer an owner-private reconnection suggestion; it cannot publish, mark ready, change a draft or infer consent. See [the design and evidence notes](docs/DESIGN.md).

## Development and portable build

```sh
npm test
npm run check
npm run package:runtime -- ./artifacts
```

The archive contains the exact server, interface, controller, guide and a per-file SHA-256 manifest. It excludes saved rooms, private drafts, invitations, credentials, tests and development dependencies. An existing artifact or checksum is not overwritten.

Extract the archive and run `node server.mjs` from its `package` directory. Run `node scripts/smoke.mjs` there for a local server-and-assets check. It uses disposable fictional state and removes only that temporary state when finished. Packaging provenance distinguishes a clean source commit from modified inputs.

This product remains in private development. Public release, competition submission, provider access and any paid infrastructure are separate decisions.

## Browser receiving

The development-only browser course uses Playwright 1.64.1 and Linux Chrome at `/opt/google/chrome/chrome`. It requires the real Chromium sandbox; it does not disable it. Point `TURNLOOM_PLAYWRIGHT` to an existing `playwright-core` installation and `TURNLOOM_RECEIPTS` to a new receipt directory, then run `node scripts/browser-course.mjs`. Set `TURNLOOM_RUNTIME_ROOT` to an extracted package directory to exercise the same course against that delivery. Browser dependencies and the QA harness are not runtime dependencies and are excluded from the archive.

The complementary `node scripts/browser-refresh-course.mjs` course uses the same environment variables. It delays authentic session and command responses to check newer saved words, participant changes, unsaved editor state, and recovery from a background read that does not finish. Both courses can receive the same extracted runtime.
