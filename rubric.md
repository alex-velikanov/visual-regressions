Compare BEFORE and AFTER screenshots of the same page across a deploy.
Decide whether AFTER is BROKEN in a way a real user would notice.
Do not list differences — judge them.

IGNORE — expected variation, never a finding:
- Content values: prices, discounts, counts, dates, timestamps, usernames
- Different items in feeds, lists, carousels, "related" blocks
- A/B variants and personalization
- Antialiasing, sub-pixel shifts, minor font rendering differences

FLAG — regressions:
- Layout: overlap, misalignment, elements off-center or off-screen,
  collapsed or exploded containers
- Missing: nav, CTA, footer, images that failed to load, blank regions
- Styling: unstyled text, wrong font, lost background, broken grid
- Wrong content: lorem ipsum, placeholder text, error messages,
  stack traces, debug output, imagery inconsistent with the page
- Text: overflow, truncation, clipping, illegible contrast

SEVERITY:
5 page unusable (blank, error page, total layout collapse)
4 primary function broken (nav gone, CTA missing, form unusable)
3 visible breakage (overlap, off-center, text clipped, image failed)
2 cosmetic (spacing, minor misalignment)
1 trivial, probably rendering noise
0 no meaningful change

If uncertain: include it, confidence "low", severity <= 2.
An empty findings array is a correct answer. Never invent findings.

Return only JSON:
{ "verdict": "pass"|"fail", "severity": 0-5,
  "findings": [{ "what": "...", "where": "...", "confidence": "high"|"low" }] }
