-- 381 — a setup code can tell an OUT-OF-DATE helper file apart from a wrong code
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- WHAT HAPPENED (2026-09-13, the owner's second photo of the same error). A quoting fault in the
-- Windows helper was fixed and shipped. He ran the file again and got the IDENTICAL error, because
-- the copy on his Desktop was still the old one — and NOTHING could tell the two apart: not his
-- screen, not his screenshot, not our board.
--
-- The server knew perfectly well that something was wrong and had no way to say it. His code was
-- accepted at 15:43:20, a `print_agents` row called INFINITE was created, and it never came back —
-- because an old helper cannot read the token out of the reply. So the shape of the failure was:
--
--   · the code is SPENT             → he has to fetch another one
--   · a dead computer row is left   → it litters the board and takes the machine's name
--   · nothing anywhere says why     → the next attempt does exactly the same thing
--
-- WHAT CHANGES. Every helper now carries a stamp derived from its own text (lib/printHelperScript
-- → helperVersion) and sends it when it redeems a code. A claim that carries NO stamp can only be a
-- file from before today, so it is REFUSED — and refused in the one way that helps:
--
--   · the code is NOT spent      → the one on his screen still works, with its clock still running
--   · no computer row is made    → nothing to clean up, and the machine keeps its own name
--   · this column is stamped     → the Printing board can say, in words, "a computer tried to join
--                                  with an out-of-date helper file — copy the file again"
--
-- That last one matters more than it looks: an old helper CANNOT show the server's message (reading
-- it is the very thing that is broken in it), so the only screen that can carry the answer is the
-- one he is already looking at.
--
-- Additive, and safe on a database that has never seen it: the column is nullable with no default,
-- nothing reads it unless it is set, and a restaurant with no out-of-date helper never has one.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

alter table public.print_setup_codes
  add column if not exists refused_old_file_at timestamptz;

comment on column public.print_setup_codes.refused_old_file_at is
  'When a helper carrying NO version stamp last tried to redeem this code (mig 381). It means the file on that computer is from before 2026-09-13. The code is deliberately NOT spent by such an attempt — this column exists so the Printing board can say why nothing happened.';
