# M0 Spikes Checklist

This checklist validates the riskiest assumptions before building further. You run this locally on CachyOS with Reaper and Firefox. Perform each step in order. Each item has an explicit pass/fail criterion.

## 1. Virtual MIDI Port Setup (ALSA/snd-virmidi)

On CachyOS (Arch-based), load the kernel's virtual MIDI device module.

**Steps:**

1. Verify the module is available:
   ```bash
   modinfo snd-virmidi
   ```
   Pass if the command returns module information (name, filename, description).

2. Load the module (needs root):
   ```bash
   sudo modprobe snd-virmidi
   ```
   No output is expected on success. If the command hangs, press Ctrl+C and move to step 3 (PipeWire method).

   To make it survive a reboot once you know it works:
   ```bash
   echo snd-virmidi | sudo tee /etc/modules-load.d/snd-virmidi.conf
   ```

3. List ALSA MIDI devices to confirm the port exists:
   ```bash
   aconnect -l
   ```
   You should see output containing `Virtual Raw MIDI` or similar. The ports are typically `Virtual:0 to Virtual:3`.

**Pass criterion:** `aconnect -l` shows at least one Virtual MIDI port (or equivalent in `alsactl proc devices`). You can then proceed to configure Reaper.

**Fail criterion:** The module does not load or `aconnect -l` shows no Virtual ports. Proceed to step 2 (PipeWire method).

---

## 2. Virtual MIDI Port Setup (PipeWire/JACK Route, if ALSA failed)

If snd-virmidi did not work, use PipeWire's ALSA sequencer bridge to expose virtual ports.

**Steps:**

1. Verify PipeWire is running:
   ```bash
   systemctl --user status pipewire
   ```
   You should see `active (running)`.

2. Check whether the ALSA sequencer bridge is active:
   ```bash
   pw-dump | grep "alsa-seq"
   ```
   If the output is empty, the bridge may not be loaded. Check PipeWire's configuration:
   ```bash
   cat ~/.config/pipewire/pipewire.conf | grep -A 5 "alsa-seq"
   ```

3. If the bridge exists, list MIDI ports through PipeWire:
   ```bash
   pw-cli ls | grep -i midi
   ```
   or in a GUI:
   ```bash
   qjackctl
   ```
   Look for ALSA MIDI objects in the ALSA section of the Connections window.

**Pass criterion:** You can see a MIDI port (real or virtual) listed in `pw-cli ls` or qjackctl. If no ports exist, check step 4.

4. As a last resort, create a loopback MIDI port using a tool like `jack-keyboard` or direct PipeWire configuration (this is advanced; document your approach if needed).

**Fail criterion:** After these steps, no MIDI port is visible to the browser or Reaper. Escalate to the user (hardware may not expose ports, or PipeWire may need configuration outside the scope of this spike).

---

## 3. Configure Reaper to Receive from Virtual MIDI Port

**Steps:**

1. Open Reaper.

2. Go to `Options > Preferences > MIDI Devices`.

3. Under "MIDI inputs," check the box for the virtual MIDI device (e.g., `Virtual 0` or `VirMIDI-0`).

4. Click `OK`.

**Pass criterion:** The virtual MIDI device is checked and the window closes without errors.

---

## 4. Why the Port Must Exist Before Browser Access

**Context:** When a browser calls `navigator.requestMIDIAccess()`, it queries the OS's MIDI subsystem for available input and output devices. Firefox and Chrome return the list immediately; if no device is visible, the browser will auto-deny the request with no user prompt.

**Implication:** The virtual MIDI port must exist before you navigate to the deployed app. If you create the port after the browser has already queried, the browser is unaware of it. Workaround: reload the page after ensuring the port is active.

**No test step required.** This is context for the next step.

---

## 5. Firefox Site Permission Add-on for Deployed Origin

Firefox 99+ gates Web MIDI behind a per-site permission add-on. Unlike localhost (which is exempt), the deployed origin (briannadon.github.io/theory-pal) will require explicit add-on installation.

**Steps:**

1. Deploy the app (or ensure the GitHub Pages site is reachable at https://briannadon.github.io/theory-pal).

2. Open Firefox and navigate to that URL (not localhost).

3. On the page, trigger MIDI access. In the UI, this happens when you first interact with the MIDI port picker (e.g., click "Select MIDI Output").

4. Firefox will prompt you with a dialog box saying something like "This site would like to install a permission add-on for Web MIDI access." The add-on name is auto-generated (e.g., `WebMIDI access for briannadon.github.io`).

5. Click "Add to Firefox" or "Allow" in the prompt. The add-on installs automatically.

6. Refresh the page or try the MIDI access again.

**Pass criterion:** The add-on installs without error, and Firefox no longer auto-denies the `requestMIDIAccess()` call. You can proceed to see the MIDI port picker in the app (or a "No ports detected" message if the OS port is not yet active).

**Fail criterion:** Firefox does not prompt for the add-on, or the add-on fails to install. Check the browser console (F12) for errors; there may be a misconfiguration or security policy blocking the installation.

**Note:** Localhost dev server does not trigger this add-on requirement; you only see it on the deployed origin.

---

## 6. Test MIDI Port Visibility in Browser

On the deployed origin (after the Firefox add-on is installed and the virtual port is active on the OS):

**Steps:**

1. Open the browser console (F12).

2. In the console, run:
   ```javascript
   navigator.requestMIDIAccess().then(
     access => {
       const outputs = Array.from(access.outputs.values());
       console.log("Available MIDI outputs:", outputs.map(o => o.name));
     },
     error => console.error("MIDI access denied:", error)
   );
   ```

3. Observe the console output.

**Pass criterion:** The console logs one or more MIDI output port names (e.g., `["Virtual 0"]`). This confirms the browser can see the OS port.

**Fail criterion:** The console logs "MIDI access denied" or no ports are listed. Troubleshoot:
   - Confirm the virtual MIDI port still exists on the OS (`aconnect -l`).
   - Reload the page to ensure the browser re-queries the OS.
   - If using Firefox on the deployed origin, confirm the add-on is installed and active (check Firefox `about:addons`).

---

## 7. Send Test Note to Reaper

**Steps:**

1. In the browser console (on the deployed origin):
   ```javascript
   navigator.requestMIDIAccess().then(
     access => {
       const output = Array.from(access.outputs.values())[0];
       if (!output) { console.error("No MIDI output found"); return; }
       
       // Send Note On (channel 1, note 60 = middle C, velocity 100)
       output.send([0x90, 60, 100]);
       console.log("Note On sent to", output.name);
       
       // Wait 1 second and send Note Off
       setTimeout(() => {
         output.send([0x80, 60, 0]);
         console.log("Note Off sent");
       }, 1000);
     },
     error => console.error("MIDI access denied:", error)
   );
   ```

2. Reaper should receive the note on the configured virtual port. You should hear a beep or see activity in Reaper's MIDI monitor or on a connected instrument.

**Pass criterion:** Reaper receives the note (visible in the MIDI monitor or heard as a beep), and the console logs both "Note On sent" and "Note Off sent".

**Fail criterion:** Reaper does not receive the note, or the console shows an error. Troubleshoot:
   - Confirm Reaper's MIDI input is set to the virtual port and the port is armed.
   - Confirm the note was sent (check the console logs).
   - Test with `arecordmidi` on the OS to confirm the port is working:
     ```bash
     arecordmidi -l  # Lists available ports
     arecordmidi -p VirMIDI-0 /tmp/test.mid  # Records MIDI to a file
     # Then send the note and stop with Ctrl+C
     ```

---

## 8. Latency Assessment

Latency is the delay between sending a MIDI note and hearing the result. Acceptable latency for live play is typically under 100 milliseconds; tolerability depends on personal taste.

**Steps:**

1. In the browser console, send repeated note-on/note-off pairs and subjectively assess the delay:
   ```javascript
   let playing = false;
   document.addEventListener('keydown', (e) => {
     if (e.code === 'Space' && !playing) {
       playing = true;
       navigator.requestMIDIAccess().then(
         access => {
           const output = Array.from(access.outputs.values())[0];
           if (!output) return;
           output.send([0x90, 60, 100]); // Note On
           setTimeout(() => { output.send([0x80, 60, 0]); }, 500); // Note Off after 500ms
         }
       );
       setTimeout(() => { playing = false; }, 600);
     }
   });
   console.log("Press Space to send a note");
   ```

2. Press Space repeatedly and listen. Does the sound appear to follow the keypress immediately, or is there a noticeable gap?

**Pass criterion:** Latency is imperceptible or feels natural (under 50 ms is ideal, under 100 ms is acceptable). Record your subjective assessment.

**Fail criterion:** Latency is noticeable and distracting (over 150 ms). This may indicate a system configuration issue or browser limitation. Document the latency you measure and note that it may constrain the use case (live play becomes difficult, but pre-recorded playback is unaffected).

---

## 9. Chromium Smoke Test

Test the app in Chromium as a secondary browser target to ensure basic compatibility.

**Steps:**

1. Install Chromium:
   ```bash
   sudo pacman -S chromium
   ```

2. Open Chromium and navigate to https://briannadon.github.io/theory-pal.

3. Repeat steps 5-7 (Firefox add-on, port visibility, and test MIDI send) in Chromium.

**Differences from Firefox:**
   - Chromium does NOT require a site permission add-on for Web MIDI. It uses the OS-level permission system.
   - Chromium may prompt you once with a system permission dialog asking to allow Web MIDI access. Accept it.
   - If the virtual MIDI port is visible to the OS, Chromium should see it immediately after you allow the permission.

**Pass criterion:** Chromium successfully sends a MIDI note to Reaper using the same commands as Firefox (steps 6-7). No add-on is needed.

**Fail criterion:** Chromium does not see the MIDI port, or the permission dialog does not appear. Troubleshoot:
   - Confirm the virtual MIDI port is still active on the OS.
   - Reload the Chromium tab.
   - Check Chromium's settings: `chrome://settings/content/midi` to see if the origin is allowed or blocked.

---

## 10. SoundFont Playback (piano quality and latency)

The build currently uses `smplr` for the internal piano. The alternative is
`spessasynth_lib`, which supports full SF2 files and is heavier. This step decides
whether the default is good enough or worth swapping.

**Steps:**

1. Run the app locally (`npm run dev`) and click chords in the diatonic strip.
2. Judge attack latency: does the sound start when you click, or is there a lag?
3. Judge tone: is the piano usable for auditioning harmony, or distractingly synthetic?
4. Watch the network tab for how large the sample payload is and how long the first
   chord takes after a cold load.

**Pass criterion:** Attack feels immediate, tone is acceptable for auditioning, and the
first chord after page load arrives within a couple of seconds.

**Fail criterion:** Audible lag on click, or the sample load stalls the page. Then try
`spessasynth_lib` with a trimmed Salamander SF2, or trim the sample set further.

---

## Summary: What to Document

After completing all steps, document:

1. **MIDI Port Setup:** Which method worked (snd-virmidi or PipeWire)? What commands did you run?
2. **Reaper Configuration:** Confirm the virtual port is armed as an input in Reaper.
3. **Firefox Deployment Test:** Did the site permission add-on appear? Did the browser see the port?
4. **Latency:** Subjective assessment (e.g., "imperceptible", "30-50 ms", "noticeably delayed").
5. **Chromium Compatibility:** Did the test pass?
6. **Blockers:** Any showstoppers or unexpected limitations?

If all steps pass, the risky MIDI pipeline is validated. You can proceed to M1 (theory module and piano audio).
