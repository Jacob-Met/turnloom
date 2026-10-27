# TURNLOOM: design and evidence

## Consumer and mechanism

A participant may need formulation time without wanting to stop the group. A speaking queue retains ordering but can lose the statement a contribution addresses. TURNLOOM retains an immutable statement and explicit conversational purpose while the discussion continues. Readiness and publication are separate owner actions.

The interface keeps reservations next to their original statement and gives the participant a stable private composer. It does not display elapsed waiting time, typing progress, draft length or inferred emotion. Labels and focus, not color alone, convey state. These are design choices that need receiving with intended users.

Conversation state is deterministic. The server derives identity from a participant capability; client-supplied actor fields do not grant authority. Each draft mutation advances a private version. Ready, return and share check the participant's current reservation revision and draft version. Private edits revoke readiness. Withdrawal and publication are terminal for that reservation.

Readiness does not depend on a global conversation revision: otherwise a busy conversation could indefinitely prevent a slower participant from sharing. A model result does depend on the public context revision, because its interpretation of the current discussion can become stale.

## Prior art and differentiation hypothesis

The [TD Talk manual](https://download.mytobiidynavox.com/Talk/Documentation/Users%20Manual/TobiiDynavox_UsersManual_TDTalk_Windows_en-US_13000655.pdf), version 1.11 dated October 6, 2026, describes retaining a message while composing another, and partner-window modes controlling text or typing-indicator visibility. These are established related capabilities. TURNLOOM does not claim to invent AAC message preparation or partner indicators.

The proposed difference is a shared semantic reservation that remains attached to a particular statement as group topics change, followed by an owner-controlled return to that statement. Whether that difference is useful, understandable and less pressuring than ordinary hand raising or a queue is an unanswered human evaluation question.

The manual was read for research. It and its screen images are not redistributed in the application. Scenario text and the product implementation are original. Browser QA reuses the estate helper identified below. No actual participant recordings are used.

## NVIDIA and Nebius boundary

The official [NVIDIA Nemotron Nano 9B v2 model card](https://developer.download.nvidia.com/assets/ace/model_card/Nemotron-Nano-9B-V2.pdf) describes a text model with reasoning and non-reasoning configurations. It does not itself provide speech recognition or evidence of TURNLOOM performance.

The [Nebius Token Factory quickstart](https://docs.tokenfactory.nebius.com/quickstart) documents an OpenAI-compatible endpoint at `https://api.tokenfactory.nebius.com/v1/`. A documented endpoint is not an authenticated, authorized or qualified project execution route.

A substantive model task is to map public claims, questions and references and identify when a reservation's original point has become stranded. Inputs exclude private drafts. Outputs must cite existing statement IDs, bind to the exact public context and remain reviewable. The model must not infer an unfinished contribution, attribute invented words or change participant control.

Actual supported NVIDIA model availability, useful inference on Nebius, and comparison with the manual baseline remain unverified. There is no mock provider success fallback. ASR and consented recording are future additions, not hidden behavior of the current application.

## Evidence required

A meaningful technical course uses four isolated browser contexts. It follows an earlier statement through topic drift, preserves a private draft, checks readiness and explicit publication, refuses cross-participant mutations and stale actions, withdraws another reservation, exports the shared conversation, and reopens saved state after restart. Narrow layouts and keyboard focus need actual rendered inspection.

A meaningful human study requires participant input into the design and a consented four-person discussion. Compare with ordinary hand raising and a simple queue. Observe whether contributions reach their intended point, whether interruptions are unwanted, and how participants describe control and pressure. Completion time alone cannot answer those questions. No human study has been conducted for this prototype.

## QA reuse and recovery

The browser course reuses `requireChromiumSandbox` in `scripts/support/chromium-sandbox.mjs` from CHRONOS VISION merged revision `e0ac64e61e95de783a0b2be9d9205f6cf955d373`. The unchanged helper verifies Chromium's actual sandbox through an isolated CDP page; it does not supply TURNLOOM's product assertions. Those assertions exercise TURNLOOM's own fictional participant, privacy and topic-return workflow. CHRONOS application results and AWS qualification do not transfer through this reuse. The helper and browser development dependencies are excluded from the runtime archive.

Participant invitation acceptance uses a browser-generated session key retained before the request. The server binds that key's hash to the invitation, permits exact replay, rejects a different key, and keeps raw capabilities out of saved data. If a write response is uncertain, the application can reopen the already committed session. Other uncertain writes require refreshing saved state before retrying. A snapshot rename may have committed even if its subsequent directory sync fails; the server never reports such operational failures as an ordinary rejected user action.

The browser binds an asynchronous session read or command result to the participant capability and the local view generation that issued it. Starting a command or entering another participant invalidates earlier responses before they can replace the current view or error message. Background reads run one at a time, with a ten-second read timeout that permits a later normal poll. These guards do not cancel, undo or retry a command already sent to the server. A current participant's unsaved editor remains local through incoming conversation updates.
