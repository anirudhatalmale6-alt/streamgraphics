StreamGraphics Pro
==================

Let me be the very first to welcome you to StreamGraphics Pro. I am Mark here at
Manhattan Beach Studios, and I am pleased to help bring this app to our community.
Created by a video pro for video pros, a streamer for streamers. We are all in it
together, so reach out with questions, thoughts, comments and ideas.

To start:
  ON WINDOWS - use the Start Menu or Desktop shortcut 'StreamGraphics Pro'.
               Want it on the taskbar? Right-click the Start Menu entry (or the
               desktop icon) and choose 'Pin to taskbar'.
  ON A MAC   - drag StreamGraphics Pro into your Applications folder, then open
               it from there or from Launchpad. Want it in the Dock? Right-click
               its Dock icon while it runs and choose Options > Keep in Dock.

Your browser opens automatically at http://localhost:4000 - that's your control panel.
(If it doesn't open on its own, just type that address into any browser.)

If you have questions, comments or thoughts, please email mark@streamgraphicspro.com.

Also, documentation and tutorial videos are available at: www.streamgraphicspro.com.

You have a few different control panels - graphics, scoreboard, speaker and library.
Together they give you a ton of options.

CHOOSE YOUR OUTPUT
------------------
Every control panel has a 'Choose your output' box. It does two things at once: it
sets how the graphic is delivered, and it hands you the exact address to paste in.
There are four ways out, in order of how much the receiving end can do for you.

  TRANSPARENT - for OBS and vMix.
    Add the link as a Browser source (OBS) or a Web Browser input (vMix), 1920x1080.
    The transparency travels with it. Nothing to key, nothing to set up.

  CHROMA COLOR - for a switcher that keys on color.
    The graphic renders on a solid color of your choosing and you key that color out.
    Pick one that is not in your graphic.

  LUMA KEY - the same idea, keyed on brightness. Pick Luma and the graphic renders on
    solid black. Worth knowing what this actually does: it decides transparency from
    how bright each pixel is, so ANYTHING DARK in your graphic goes see-through along
    with the background - drop shadows, a dark bar, the shaded edge of a letter. It is
    fine for bright text on black. It is not the way to send a full-color brand board.

  KEY + FILL - the right answer for a hardware switcher, and nothing is guessed.
    You get two links instead of one. The FILL is your graphic on black; the KEY is a
    white silhouette of the same shape. Send them out of two video outputs and wire
    them to the switcher's fill and key inputs. Soft edges and see-through panels come
    out looking the way they do in OBS. On an ATEM, turn PRE-MULTIPLIED KEY on.
    This needs two video outputs from the computer. With one, use Luma or Chroma.

PUT IT ON A MONITOR
-------------------
Feeding a screen, a projector or a switcher straight off this computer? Every panel
with an output also has a 'Put it on a monitor' box. Hit 'Find my monitors', pick one,
and send it - the output opens full screen on that screen, and closes again from the
same box. It remembers which monitor by name, so unplugging a screen between shows
will not send the next one to the wrong place. (This only works on this computer:
no browser can place a window on another computer's monitor.)

To use a phone, tablet or another computer on the same network:
  Open StreamGraphics Pro on this PC and look at the box near the top of the
  home page, 'Use on another device (same network)'. It shows this computer's
  own address. Type that on the other device. Read it from there every time -
  network addresses are different on every network and can change.
(Your computer may ask to allow network access the first time - click Allow on Windows,
or "Allow incoming connections" on a Mac.)

Nothing runs in the cloud. Everything is on this computer. No internet required -
unless you are using a remote phone or controller to manage a scoreboard, or a remote
Bitfocus Companion connection. Those use a small cloud relay.

WHERE YOUR WORK IS KEPT
-----------------------
Your presets, templates, saved shows, scripts and the images you bring in are yours.
Installing a new version leaves all of it alone.
  ON WINDOWS - in the app's own folder, under your user account.
  ON A MAC   - in  ~/Library/Application Support/StreamGraphics Pro
               (in Finder: Go > Go to Folder, and paste that in.)
The scoreboard's Team Library card shows you the exact logos folder for THIS
computer, so you never have to guess where to drop a team's PNG.

Trouble starting?
  ON WINDOWS - use 'Troubleshoot (show console)' in the Start Menu to see messages.
  ON A MAC   - if macOS says it cannot verify the app, right-click it and choose
               Open, then Open again. Once only, and only on an unsigned copy.

(c) Manhattan Beach Studios LLC. Licensed, not sold - see LICENSE.txt.
