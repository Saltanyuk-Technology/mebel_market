from airqore_orm import BigIntegerField, BooleanField, DateTimeField, Model, StringField


class User(Model):
    class Meta:
        table = "users"
        managed = False

    id = BigIntegerField(primary_key=True)
    email = StringField(unique=True)
    password_hash = StringField()
    firstname = StringField()
    secondname = StringField()
    phone = StringField(null=True)
    category = StringField(default="user")
    confirmed = BooleanField(default=True)
    disabled = BooleanField(default=False)
    created_at = DateTimeField()
    updated_at = DateTimeField()
    last_login_at = DateTimeField(null=True)
