This edit writes a comment pattern AGENTS.md § Code comments forbids.

Substitutions:

- Credit a bead — the commit subject, never the code. `git blame` recovers it.
- Reference a memory — nothing in code. A wikilink is invisible to any reader
  without bd.
- Cite a pull request — drop it; the history is in git.
- Decomposition history ("moved from X") — the diff already shows it.

Rewrite the comment without the reference, or delete it: the default action on
a comment that does not clearly earn its keep is delete, not reword.
