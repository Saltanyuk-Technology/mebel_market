import argparse
import asyncio
import getpass

from passlib.context import CryptContext

from database import orm


password_context = CryptContext(schemes=["bcrypt_sha256"], deprecated="auto")


async def create_admin(email: str, firstname: str, secondname: str, password: str) -> None:
    await orm.startup()
    try:
        password_hash = await asyncio.to_thread(password_context.hash, password)
        await orm.execute(
            """INSERT INTO users (email, password_hash, firstname, secondname, category)
               VALUES ($1, $2, $3, $4, 'admin')""",
            email.strip().lower(), password_hash, firstname.strip(), secondname.strip(),
        )
    finally:
        await orm.shutdown()


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a Mebel Market administrator")
    parser.add_argument("email")
    parser.add_argument("firstname")
    parser.add_argument("secondname")
    args = parser.parse_args()
    password = getpass.getpass("Password (minimum 8 characters): ")
    if len(password) < 8:
        raise SystemExit("Password is too short")
    asyncio.run(create_admin(args.email, args.firstname, args.secondname, password))


if __name__ == "__main__":
    main()
