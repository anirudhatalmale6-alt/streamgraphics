The SIGNED "StreamGraphics Pro.exe" launcher lives in this folder.

build.sh uses it verbatim and skips compiling a fresh (unsigned) one. See BUILD.md for why
the launcher needs a signature of its own and why signing it once is enough.

The copy here was signed on 2026-08-11 (Manhattan Beach Studios LLC, via Azure Artifact
Signing). It does NOT need signing again on every release: launcher.nsi pins the version
resource to a fixed 1.0.0.0, so the compiled stub is byte-identical release after release
and this one signed copy stays valid.

It only has to be re-made if launcher.nsi itself changes - and if you do change it, the new
stub is a different file, so it must be signed again before release or customers go back to
getting a SmartScreen warning on the file they click every day.

Note it is committed deliberately, against the *.exe rule in .gitignore. Treat it as source.
