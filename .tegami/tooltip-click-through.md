---
packages:
  'floating-ellipsis': minor
---

### A click on a tip goes to what's under it

A press on a full-text tip that doesn't move is a click on the element under the tip, such as the link or the row the truncated text is in: the tip lets go and passes the pointer events, the focus and the click on. Only a drag of 4px or more selects the tip's text, and only a drag holds the tip open. Two and three presses no longer select a run or all of the text in the tip, as each press is a click on what's under it.
