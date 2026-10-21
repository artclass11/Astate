#!/usr/bin/env python3
"""Email public-only Astate JSON/CSV backups over authenticated SMTP."""
from email.message import EmailMessage
from pathlib import Path
from datetime import datetime, timezone
import mimetypes
import os
import smtplib
import ssl
import sys

BACKUP_DIR = Path("backups")
FILES = [BACKUP_DIR / "public-listings.json", BACKUP_DIR / "public-listings.csv"]
TO = "artclassstudio11@gmail.com"


def main() -> int:
    host = os.environ.get("SMTP_HOST", "").strip()
    port_text = os.environ.get("SMTP_PORT", "").strip()
    username = os.environ.get("SMTP_USERNAME", "").strip()
    password = os.environ.get("SMTP_PASSWORD", "")
    sender = os.environ.get("SMTP_FROM", "").strip() or username
    if not all((host, port_text, username, password, sender)):
        print("SMTP secrets missing; no email was sent. Configure SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, and optionally SMTP_FROM.")
        return 2
    try:
        port = int(port_text)
    except ValueError:
        print("SMTP_PORT must be an integer (usually 465 or 587).", file=sys.stderr)
        return 2

    for path in FILES:
        if not path.is_file() or path.stat().st_size == 0:
            print(f"Expected backup file missing or empty: {path}", file=sys.stderr)
            return 2

    msg = EmailMessage()
    now = datetime.now(timezone.utc)
    msg["Subject"] = f"Astate weekly public listings backup — {now:%Y-%m-%d}"
    msg["From"] = sender
    msg["To"] = TO
    msg.set_content(
        "Attached is Astate's weekly export of publicly published real-estate listings.\n\n"
        "This email contains public listing fields only. It does not include private intake records, phone/email fields, "
        "or administrator-only CMS data. Keep this attachment as an offline copy; it is not a full database disaster-recovery backup.\n"
        f"Export requested at {now.isoformat()}."
    )

    for path in FILES:
        mime, _ = mimetypes.guess_type(path.name)
        maintype, subtype = (mime or "application/octet-stream").split("/", 1)
        msg.add_attachment(path.read_bytes(), maintype=maintype, subtype=subtype, filename=path.name)

    context = ssl.create_default_context()
    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, context=context, timeout=20) as smtp:
                smtp.login(username, password)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=20) as smtp:
                smtp.ehlo()
                smtp.starttls(context=context)
                smtp.ehlo()
                smtp.login(username, password)
                smtp.send_message(msg)
    except Exception as exc:  # SMTP provider errors do not contain message attachments, but keep output compact.
        print(f"SMTP delivery failed ({type(exc).__name__}): {exc}", file=sys.stderr)
        return 1
    print(f"Email sent to {TO} with {len(FILES)} public-only attachments.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
