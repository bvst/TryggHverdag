---
name: mac-android-toolchain
description: On claude-dev the default JAVA_HOME (Android Studio's JBR 25) breaks the app's native build; a JDK 17 lives in ~/jdks, the Pixel_8 AVD is set to nb-NO, and its android-37.2 image lists no calls in `gsm list` and crash-loops a UWB HAL
metadata:
  type: project
---

Found running INF-06's L7 and dev build on the Mac (`claude-dev`, 2026-09-25):

- **JBR 25 fails the Android build.** With `JAVA_HOME` at Android Studio's JBR 25, `./gradlew :app:assembleRelease` fails in every `configureCMake…[x86_64]` task with `WARNING: A restricted method in java.lang.System has been called` (JDK 24+ native access), after about 18 minutes. The spec's R14 predicted it. **Temurin 17.0.20.1** is unpacked, checksum-verified, at `~/jdks/jdk-17.0.20.1+1/Contents/Home`. Prefix Android builds with `JAVA_HOME="$HOME/jdks/jdk-17.0.20.1+1/Contents/Home"`. `~/.zshrc` was not changed. CI uses setup-java 17 and is not affected.
- **The `Pixel_8` AVD's language is now nb-NO.** It was booted with `-change-locale nb-NO`, because `e2e:android` refuses any other locale. Boot it headless with `emulator -avd Pixel_8 -no-window -no-audio -no-boot-anim -no-snapshot-save -gpu swiftshader_indirect`. The first boot took 84 s.
- **Stop Colima before booting the emulator** (16 GB, spec R14), and `colima start` afterwards. gate:full's integration step needs Docker.
- The pinned Maestro is cached at `node_modules/.cache/maestro/2.10.0/` (315 MB download, about 2 min).
- Warm release build: about 1.5 to 2 minutes. A full `pnpm run e2e:android` takes about 2 minutes with caches warm (2026-09-26: 194 s including a 2 m 42 s Gradle build; boot took 31 s).
- **No `timeout` or `gtimeout` binary on this Mac** (no coreutils). Use the Bash tool's own timeout. Wait for boot without a local sleep: `adb wait-for-device shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 2; done'`.
- **Teardown that leaves nothing:** `adb -s emulator-5554 emu kill`, then `./gradlew --stop` from `apps/mobile/android` with the JDK 17 `JAVA_HOME`, then `adb kill-server`. The emulator takes up to about 20 s to exit (its `emulator -kill <pid> -sleep 20` helper), and the Kotlin compile daemon exits with Gradle's. Check again with `pgrep -fl "qemu-system|GradleDaemon|KotlinCompileDaemon|maestro"` (VS Code's `chrome_crashpad_handler` is unrelated).

Found on the same image in SPIKE-01 (2026-09-30, Android 17 / API 37, page size 16384):

- **`adb emu gsm list` never lists a call** on this image: it answers `OK\r\n` alone for outbound calls (the modem ends them with a REMOTE/NORMAL disconnect about 0.4 s after DIALING) and for a ringing inbound `gsm call` too. `adb shell dumpsys telecom` records every call with its state changes. Don't spend time polling the console.
- **The crash buffer is noisy:** the image's UWB HAL (`/vendor/bin/hw/android.hardware.uwb-service`) SIGABRTs every 5 s from boot, so `logcat -b crash -d` is never empty. Android 17's native-crash header reads `pid: N, ppid: N, tid: N, name: …  >>> process <<<`.
- **`screencap -p`** gives an 8-bit RGBA PNG (colour type 6) with `sBIT` and `sRGB` chunks and hundreds of IDAT chunks.
- **A spike or app build outside the workspace** reuses the warm Gradle cache: `assembleDebug` for x86_64 took 53 s from a fresh `android/`. The Kotlin daemon from Expo's Gradle plugin lingers a few seconds after `./gradlew --stop`, then exits.
- **Summarise Gradle `--info` output with a Node filter, not `sed`:** BSD `sed -E` rejects an empty alternative such as `(a/|)`, and the pipe then loses the build's output.

**Why:** each of these cost a slow round trip to find.

**How to apply:** for any L7 or dev-build work on the Mac, use the JDK 17 path above, and say in the report that the machine's default Java cannot build the app. Suggest the owner point `JAVA_HOME` at a JDK 17 (a `doctor` check could catch it). Related: [[stale-git-on-path]].
