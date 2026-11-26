# SocialTask SCRM · 3COOL UI design system

## Scope and visual source

UI refresh based on the ImageGen workbench concept supplied in the design conversation. Reference base: `812d7e9e8bb27dcc06db43f2c5d854af4d8c0868`.
The concept is a layout and visual direction, not evidence of supported data/API features. All runtime data continues to use the existing SocialTask APIs. This refresh does not change authentication endpoints, OAuth rules, database migrations, DSH plugin assets or server permissions.

## Design tokens

| Token | Value | Use |
|---|---|---|
| Navigation | `#111c35` / `#192744` | Dark desktop navigation |
| Primary | `#245deb` | Primary action, selected module and focus |
| Workspace | `#f2f5fa` | Neutral background |
| Surface | `#ffffff` | Cards and dialogs |
| Ink | `#17243d` | Main text |
| Muted | `#586982` | Secondary text |
| Border | `#e0e6ef` | Dividers and outlines |
| Green | `#087b5d` | Successful / configured states, not online presence |
| Orange | `#a65b09` | Pending review, time risk |
| Red | `#b42338` | Failure, breach or overdue |
| Radius | 7–12 px | Controls and surfaces |

Use the system sans-serif stack with Chinese fallbacks. Do not require a remote font, new runtime dependency or generated image as a UI background. Use consistent density (12–14px body text, 26px page heading, 36px standard buttons, 44px mobile actions); secondary labels remain secondary, not invisible. Focus rings and semantic form labels are mandatory for shared controls. Honor reduced motion.

## Layout and component rules

- Desktop: grouped navigation (13 existing routes), persistent current page, collapsible rail; topbar and bounded content width.
- WeCom inbox: list, conversation and member/ticket rail at desktop widths above 1180px; two columns with the context below on narrower desktop/tablet; below 620px, list and conversation become separate view states with a visible back control. Keep the composer visible at typical viewport sizes and independently scroll long message history.
- Member rail uses `person_name`, `peer_userid`, `person_id`, `group_name` and `last_message_at` from the existing conversation response. Association with a person record is not login authorization or online status. The channel indicator reflects configuration only, not actual connectivity, message delivery or read receipt.
- Quick ticket creation uses a conversation-scoped API, immutable source message and optional versioned template with approved materials. Related tickets are loaded from the source-message foreign key (latest 50). No chat attachment sending, customer private chat or online-presence signal is simulated.
- Dashboard uses current API metrics, real task links and progress from existing data, not time-series assumptions or fabricated percentages.
- Remaining admin modules retain their workflows and inherit shared PageHeading, Table, Status, Field, Modal, Feedback, Empty, filters, drawers and design tokens.
- Mobile H5 uses actionable task-state filters and safe-area-aware bottom navigation. Task detail and custom fields inherit the new design. Login retains password, error handling, and WeCom automatic card OAuth return exactly as before; mobile shows the form without a decorative split-screen.

## Maintenance

`apps/web/src/app/redesign.css` is imported after `globals.css` in root layout. Retain existing class names where browser acceptance depends on them. Avoid changing API contracts for aesthetic reasons. Do not create duplicate or disabled-looking controls for capabilities that are not implemented.

See `docs/verification/UI_REDESIGN.md` for actual checks and remaining full-app acceptance steps.
