"""Optional diagnostic embedding comparison, separate from scored evidence."""

from functools import lru_cache


@lru_cache(maxsize=2)
def load_model(path="all-MiniLM-L6-v2"):
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(path)


def similarity(answer: str, reference: str, model_path="all-MiniLM-L6-v2") -> float:
    """Cosine similarity is not truth or rubric entailment; not used as a gap label."""
    embeddings = load_model(model_path).encode([answer, reference], normalize_embeddings=True)
    return float(embeddings[0] @ embeddings[1])
