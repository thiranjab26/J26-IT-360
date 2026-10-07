"""Existing C01/C02/C03 adapters; local course authoring is separate in materials.py."""

from typing import Literal, Protocol

from pydantic import BaseModel, Field

TOPICS = {
    "stacks": ("Stacks", "DSA", "Last-in, first-out behavior and stack operations."),
    "queues": ("Queues", "DSA", "First-in, first-out behavior and queue operations."),
    "oop": ("Object-oriented programming", "OOP", "Encapsulation and inheritance."),
    "databases": ("Databases", "DBMS", "Keys and database normalization."),
}
MATERIAL = {
    "stacks": "A stack follows last-in, first-out (LIFO): the most recently inserted item is removed first. Push adds to the top; pop removes from the top. Popping an empty stack causes underflow.",
    "queues": "A queue follows first-in, first-out (FIFO): the earliest inserted item is removed first. Enqueue adds to the rear; dequeue removes from the front. A queue supports ordered task scheduling.",
    "oop": "Encapsulation bundles data with methods and restricts direct access to internal state. Controlled interfaces help protect invariants. Inheritance lets a subclass reuse or extend a superclass; it models an is-a relationship, while composition models has-a.",
    "databases": "A primary key uniquely identifies each row and cannot be null. A foreign key references a key in another or the same table and maintains referential integrity. Normalization reduces redundant data and prevents update, insertion, and deletion anomalies by organizing related facts into tables.",
}


class ContextAdapter(Protocol):
    def context(self, topic_id: str, participant_id: str) -> dict: ...


class MockContextAdapter:
    mode = "mock"

    def context(self, topic_id, participant_id):
        name, course, _ = TOPICS[topic_id]
        return {
            "c01": {
                "topic": name,
                "mastery": 82,
                "confidence": 77,
                "starting_difficulty": "intermediate",
                "source": "mock C01 sample; not participant evidence",
            },
            "c02": {
                "cognitive_load": "medium",
                "frustration": "low",
                "engagement": "normal",
                "source": "mock C02 sample; not diagnostic evidence",
            },
            "c03": {
                "course_id": course,
                "topic": name,
                "chunks": [
                    {"text": MATERIAL[topic_id], "source": f"Demo {name} course notes", "page": 1}
                ],
                "review_resources": [
                    {
                        "title": f"{name}: course review notes",
                        "resource_id": f"demo-{topic_id}-notes",
                    }
                ],
                "source": "mock C03 retrieval; replace with teammate API",
            },
        }


class HTTPContextAdapter:
    """Configured components use HTTP, unconfigured components remain explicitly mock."""

    def __init__(self):
        self.mock = MockContextAdapter()

    @property
    def mode(self):
        from app.config import settings

        cfg = settings()
        count = sum(bool(v) for v in (cfg.c01_api_url, cfg.c02_api_url, cfg.c03_api_url))
        return "http" if count == 3 else ("mixed_http_mock" if count else "mock")

    def context(self, topic_id, participant_id):
        import httpx

        from app.config import settings
        from app.integrations.llm import ProviderUnavailable

        cfg = settings()
        result = self.mock.context(topic_id, participant_id)
        if not any((cfg.c01_api_url, cfg.c02_api_url, cfg.c03_api_url)):
            return result
        headers = (
            {"Authorization": f"Bearer {cfg.integration_api_token}"}
            if cfg.integration_api_token
            else {}
        )
        topic, course, _ = TOPICS[topic_id]
        try:
            with httpx.Client(timeout=cfg.integration_timeout_seconds, headers=headers) as client:
                for component, url in (("c01", cfg.c01_api_url), ("c02", cfg.c02_api_url)):
                    if not url:
                        continue
                    response = client.get(
                        url, params={"topic_id": topic_id, "participant_id": participant_id}
                    )
                    response.raise_for_status()
                    content = response.json()
                    if component == "c01":
                        normalized = C01Context.model_validate(
                            {**content, "source": "HTTP C01 adapter"}
                        ).model_dump()
                    else:
                        normalized = C02Context.model_validate(
                            {**content, "source": "HTTP C02 adapter"}
                        ).model_dump()
                    result[component] = normalized
                if cfg.c03_api_url:
                    response = client.post(
                        cfg.c03_api_url,
                        json={"topic": topic, "courseId": course, "studentId": participant_id},
                    )
                    response.raise_for_status()
                    content = response.json()
                    resources = content.get("review_resources", content.get("reviewResources", []))
                    result["c03"] = C03Context.model_validate(
                        {
                            "topic": content.get("topic", topic),
                            "course_id": content.get("course_id", content.get("courseId", course)),
                            "chunks": content["chunks"],
                            "review_resources": [
                                {
                                    "title": r["title"],
                                    "resource_id": r.get("resource_id", r.get("resourceId")),
                                    **({"url": r["url"]} if r.get("url") else {}),
                                }
                                for r in resources
                            ],
                            "source": "HTTP C03 retrieval adapter",
                        }
                    ).model_dump(exclude_none=True)
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            raise ProviderUnavailable(
                f"Configured integration failed or returned invalid context ({type(exc).__name__}). Check C01/C02/C03 endpoint contracts; no mock substitution was made."
            ) from exc
        return result


class C01Context(BaseModel):
    topic: str
    mastery: float = Field(ge=0, le=100)
    confidence: float = Field(ge=0, le=100)
    starting_difficulty: str
    source: str


class C02Context(BaseModel):
    cognitive_load: Literal["low", "medium", "high"]
    frustration: str
    engagement: str
    source: str


class Chunk(BaseModel):
    text: str = Field(min_length=1, max_length=12000)
    source: str = Field(min_length=1)
    page: int | None = Field(default=None, ge=1)


class ReviewResource(BaseModel):
    title: str
    resource_id: str
    url: str | None = None


class C03Context(BaseModel):
    course_id: str
    topic: str
    chunks: list[Chunk] = Field(min_length=1, max_length=50)
    review_resources: list[ReviewResource]
    source: str


adapter: ContextAdapter = HTTPContextAdapter()
