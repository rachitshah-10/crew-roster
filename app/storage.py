"""Password hashing and timestamps. Database access lives in app.repository."""
import hashlib
import hmac
import secrets
import threading
from datetime import datetime, timedelta, timezone

_clock = threading.Lock()
_last = None


def now():
    """UTC ISO timestamp, strictly increasing within this process so records created
    in the same microsecond still sort in creation order."""
    global _last
    with _clock:
        moment = datetime.now(timezone.utc)
        if _last is not None and moment <= _last:
            moment = _last + timedelta(microseconds=1)
        _last = moment
    return moment.isoformat().replace("+00:00", "Z")


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 600_000).hex()
    return salt + ":" + digest


def verify_password(password, stored):
    return hmac.compare_digest(password_hash(password, stored.split(":")[0]), stored)
