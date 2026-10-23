# FIX: hover states on every button (owner, 2026-10-23)

UX-PLAN.md first. Small fix, one session.

Bug (Eric, Oct 22, screenshot): the "New post" button in the left menu
nearly disappears on hover. Its text and icon go dark on a dark fill.
Likely others too.

1. Sweep every button, link-button, chip, menu item, tab and icon button
   in the app: default, hover, focus, active, disabled, selected.
2. Rule for UX-PLAN.md: hover never lowers contrast. Text and icon keep
   at least 4.5:1 against the hover fill (3:1 for icons). Hover only
   lightens or tints the fill, or adds a border.
3. Primary buttons (New post, Generate, Make the week, Send to Drive)
   keep their accent fill on hover, slightly brighter, text stays
   readable.
4. Focus ring visible on every control for keyboard use.
5. Put all hover and focus colors in the theme tokens. No one-off colors
   in components.
6. Browser test: hover each button type on Weeks, Posts, a post
   workspace, Line bank, Characters and Settings, measure text contrast,
   fail under 4.5:1. Must fail on the current version and pass after.

FINISH: tests pass. Push. Confirm the deploy is READY and the version.
Report the list of buttons fixed, with before and after screenshots of
New post on hover from production.
