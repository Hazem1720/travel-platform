# Requirements

## Official sources (these win)

The course gives three files. They are the only official sources; everything else in the repository must agree with them.

| File | What it is |
|---|---|
| `Project Description.pdf` | Project description: scope, milestones, Git workflow (section 10), AI usage log (section 11) |
| `OFFICIAL-requirements.xlsx` | Official requirements sheet: 104 Mandatory and 11 Bonus requirements with IDs |
| `official-datasets/Mock Data.xlsx` | Official reference data used in the final evaluation (airports, cities, countries, attractions) |

These files are **not committed**: the repository is public, and course material should only be added there if the team leader agrees. Keep your own copy in this folder; the root `.gitignore` does not hide them, so do not `git add` them by accident.

## Team files

| File | What it is |
|---|---|
| `requirements-tracker.csv` / `.xlsx` | Team tracker: each official requirement with its owner, milestone and status. The ID, Type, Module, Actors, Requirement, Dependencies and Complexity columns must match the official sheet exactly; only the team columns (Owner, Milestone, Status, links, notes) are ours. |

`backend/seed-data/*.csv` must be an exact copy of the sheets in `Mock Data.xlsx`. `npm test` checks the record counts and identifiers.
