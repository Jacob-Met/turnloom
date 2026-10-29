# TURNLOOM on an Apple silicon Mac

This private portable folder includes Node.js 22.23.4. No Node or npm installation, runtime dependency download, provider account or network service is needed.

1. Extract the complete `TURNLOOM` folder into a writable location.
2. From Terminal, run `./TURNLOOM.command` inside that folder. The launcher uses the bundled runtime regardless of your shell's Node installation.
3. Open the printed loopback URL in your browser. Keep the Terminal window open; press Control+C to stop.

The file has a Finder-recognized `.command` extension, but Finder launch, download quarantine, signing and notarization are separate qualification paths. This is not a signed Mac application. Respect normal macOS security controls; this guide does not change or bypass them.

## Existing behavior is preserved

The launcher forwards the existing `--port` and `--data-dir` arguments and retains the `PORT` and `TURNLOOM_DATA_DIR` environment settings. For an unused port and a separate private data directory:

```sh
./TURNLOOM.command --port 0 --data-dir "/absolute/path/to/private-turnloom-data"
```

Without an explicit data directory, saved rooms are inside `app/.turnloom`, not the Terminal's working directory. Keep that directory to reopen work; never distribute a used folder containing private rooms. Do not run two writers on the same saved directory. The original server's writer lock and participant controls are unchanged.

The host operator and the fictional-demo creator are not excluded from the privacy boundary. No microphone, model inference or automatic speech is added. This is fictional local software, not evidence of AAC benefit or universal accessibility.

## Build provenance

Build on macOS arm64 from a clean committed checkout:

```sh
npm run package:macos -- /absolute/path/node-v22.23.4-darwin-arm64.tar.gz NEW_OUTPUT_DIRECTORY
```

The offline builder reuses the maintained runtime source allowlist. It pins the official Node archive and executable SHA-256 values, includes Node's license and README, verifies system-only dynamic linkage, and writes a source/runtime identity and per-file manifest. Existing output directories are not overwritten.

Runtime pin and dependency check are reused from the estate's qualified EQUIVIA Mac packaging procedure; its product qualification does not transfer to TURNLOOM. Receive this package's actual launcher, exact served assets, saved-room restart and browser workflows separately.
