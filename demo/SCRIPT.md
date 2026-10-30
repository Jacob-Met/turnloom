# Turnloom demo script

About 400 words, roughly 120 seconds at 200 words per minute. Screenshots: `demo/steps/NN.png`, captured by a headless dry run against port 4404. Every selector existed when its step ran, and the status line after each step matched the narration.

| Step | Narration | On screen |
|---|---|---|
| 1 | Turnloom is for group conversations where someone needs more time to write what they want to say. It keeps your place on the exact statement you mean to answer. | Welcome screen with the "Start the four-person demo" button. |
| 2 | We will start the demo. It has four made-up people deciding where their reading circle should meet. | Invitation list with one "Enter as" link per person. |
| 3 | Each person gets their own invitation. We open the one for Mira. | Mira's workspace: the thread of five statements and the private composer below. |
| 4 | Sam says the garden gate is sometimes locked. Mira wants to answer that, but not yet. So she keeps a place on Sam's statement. | Sam's statement is in view; the composer docks beneath it, connected to that statement. |
| 5 | The workspace now shows that exact statement. Mira chooses what kind of reply this is. Here it is a question, and she keeps the place open. | Composer shows "Connected to" Sam's sentence, intent set to "A question", "Keep this place open" button. Status: Place kept open. |
| 6 | She writes her words in private. Nobody else can see this draft. | Draft field filled with the sample question. Save draft is enabled. |
| 7 | She saves the draft, then marks herself ready. Ready means she is available. Her words stay private. | Status: "Ready to return"; message "You are ready. Your draft is still private." |
| 8 | Meanwhile the group moves on. The conversation changes from where we meet to when we meet. | Topic set to "When we meet"; notice confirms the conversation moved. |
| 9 | Mira's place stays on Sam's statement. The topic changed, but the link did not. | Composer still shows Sam's statement and the ready status. |
| 10 | Now Mira asks for an optional suggestion. The server sends Nemotron, a model from NVIDIA running on Nebius Token Factory, only Sam's statement, the current topic and recent public statements. Her draft is never sent. | The suggest button is clicked; the cue area becomes visible with the model's suggestion. |
| 11 | The suggestion appears as a separate note. The server accepts it only if it cites Sam's statement, and only if her draft and the conversation have not changed since she asked. Nothing is shared from it. | The cue panel shows the neutral reference. |
| 12 | Mira ignores it. Her words stay exactly as they were. | The cue is dismissed. |
| 13 | When she is ready, she brings the original point back. Only a neutral reference to Sam's statement is shared, not her words. | Status: "Original point brought back"; "Bring back" replaced by the review stage. |
| 14 | Before anything is shared, she reviews the exact words. Then she chooses to share them as herself. | Review panel shows the exact draft with "Share these words as me". |
| 15 | She shares them. Her contribution now sits next to the point it answers. | Status: "Contribution shared"; notice "Your approved words have been shared." |
| 16 | Turnloom keeps your words yours, and keeps them connected to the point you meant. | Shared state stays on screen. |

Notes for review:
- The demo shows Nemotron from NVIDIA running on Nebius Token Factory providing optional return suggestions. The model receives only the original statement, current topic, and recent public statements—never the private draft.
- Step 8 uses the topic control. It is a real feature, so the narration says "moves on" without implying other people made the change. Only Mira is driven in this demo.
- The demo does not show another participant replying. That would require switching sessions, which this single-window script does not do.
