# Local Bike Guy - V.11

Unified operational workflow.

- Inbox is now the intake queue for customer communication and appointment requests.
- One conversation per normalized customer email.
- Actual appointment records render chronologically inside the customer Inbox thread.
- Requested appointments have direct Approve and Cancel actions in Inbox.
- Appointment detail has direct Approve and Cancel actions while status is Requested.
- The status dropdown is reserved for approved/in-progress appointments.
- Appointments main page is now the schedule for approved work, not a duplicate incoming-request queue.
- Appointment detail links back to the customer's Inbox conversation.
- Existing unified-thread scrolling, Socials workflow, two-way email work, and local loadEnv/Resend fix are retained.

No new database migration is required for V.11.


## V.11.1 - Notification-only email workflow
- Admin notification recipient remains controlled by Admin Settings.
- Notification sender defaults to `Local Bike Guy <inquiry@onetimelabs.net>`.
- New message and appointment notifications link directly to the matching Admin Inbox conversation.
- Notification emails instruct the admin not to reply by email and use `no-reply@onetimelabs.net` as Reply-To.
- Removed inbound email webhook handling and the unused legacy `/api/notify` endpoint.
- Admin replies sent from LBG now stop on Resend errors instead of creating a false sent-message bubble.
- Removed temporary Resend key fingerprint fields from `/api/health`.

## V11.2 - Branded Email Replies
- Branded HTML customer replies with Local Bike Guy logo.
- Inbox Enter key opens a send-confirmation dialog; Shift+Enter adds a line break.
- Customer reply template is editable in Admin > Settings with live preview.
- New booking/message notification destination comes only from business_settings.notification_email.
- Removed obsolete inbound-email and legacy notification endpoints.
- Run supabase/005_email_template_settings.sql once before using the new Settings template fields.
