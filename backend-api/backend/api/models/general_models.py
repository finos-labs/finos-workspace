"""General models"""

from sqlalchemy import Column, Integer, Text

from api.models.model_helpers import Base, DateMixin, UUIDMixin


class Log(Base, UUIDMixin, DateMixin):
    """Logs errors in our requests"""

    __tablename__ = "log"

    request = Column(Text(), default=None)
    error = Column(Text(), default=None)
    status_code = Column(Integer(), default=None)
    method = Column(Text(), default=None)

    def __str__(self) -> str:
        return f"{self.request}-{self.error}"
