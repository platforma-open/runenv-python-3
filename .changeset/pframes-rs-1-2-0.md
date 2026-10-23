---
'@platforma-open/milaboratories.runenv-python-3.12.10': patch
---

PFrames bump: polars-pf 1.2.0. Joins on Int or Long axes of JsonPartitioned columns now give the correct rows; before, keys stored in string order (1, 10, 2) gave missed matches and duplicate rows. Outer joins of same-axis columns no longer sort the secondary rows again, and result tables use smaller compressed row groups, which lowers peak memory.
