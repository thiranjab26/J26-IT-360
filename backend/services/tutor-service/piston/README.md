# Piston code runner

Sandboxed execution of student code submissions. **C3 only, from phase P4.**

This lives inside tutor-service because it is a private dependency of this service, exactly like `.chroma/`. No other component talks to it. It is the one place in the project where Docker is used, and keeping it here means the rest of the repository stays Docker free.

Student code never runs inside the tutor-service process. Submissions go out to Piston over `TUTOR_PISTON_URL` (default `http://localhost:2000`), which is stubbed until P4.

When P4 starts, this folder gets the compose file, the pinned Piston version, the language runtimes to install, and the resource and timeout limits.
