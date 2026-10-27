"""Configuration and path resolution for the ConduitAI FastAPI backend."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent

_PLACEHOLDER_PREFIXES = ("your_", "changeme", "replace_with_")


def _resolve_repo_or_backend_path(raw: str | Path) -> Path:
    """Resolve a path relative to either `backend/` or repo root (`conduit-ai/`)."""
    candidate = Path(raw)
    if candidate.is_absolute():
        return candidate.resolve()

    from_backend = (BACKEND_DIR / candidate).resolve()
    if from_backend.exists():
        return from_backend

    from_repo = (REPO_ROOT / candidate).resolve()
    if from_repo.exists():
        return from_repo

    return from_backend


def is_secret_configured(value: str | None) -> bool:
    """Return True if an API key/secret is non-empty and not a template placeholder."""
    if not value:
        return False
    cleaned = value.strip()
    if not cleaned:
        return False
    lowered = cleaned.lower()
    if any(lowered.startswith(prefix) for prefix in _PLACEHOLDER_PREFIXES):
        return False
    return True


class Settings(BaseSettings):
    """Application settings loaded from `.env` (repo root and/or `backend/.env`)."""

    model_config = SettingsConfigDict(
        env_file=(str(REPO_ROOT / ".env"), str(BACKEND_DIR / ".env")),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # 1. Meta Model API
    meta_model_api_key: str = Field(default="")
    meta_api_base_url: str = Field(default="https://api.meta.ai/v1")
    muse_spark_model: str = Field(default="muse-spark")
    muse_wonder_model: str = Field(default="muse-wonder")
    sam_3_1_model: str = Field(default="sam-3.1")
    muse_image_model: str = Field(default="muse-image")
    muse_voice_transcribe_model: str = Field(default="muse-voice-transcribe")
    muse_code_model: str = Field(default="muse-code")

    # 2. Baseten Open-Weights Inference
    baseten_api_key: str = Field(default="")
    baseten_api_base_url: str = Field(default="https://inference.baseten.co/v1")
    baseten_model: str = Field(default="meta-models/muse-spark-open-1026")

    # 3. Modal Serverless GPU & Verifiable Digital Twin Sandboxes
    modal_profile: str = Field(default="lopesrohan1988")
    modal_sandbox_timeout: int = Field(default=60)
    air_gapped_open_weights_mode: bool = Field(default=False)
    muse_glimmer_model: str = Field(default="meta-models/Muse-Glimmer-30B")
    muse_glimmer_endpoint_url: str = Field(default="")

    # 4. ConduitAI Application & Workbench Settings
    demo_cache_fallback: bool = Field(default=True)
    next_public_api_url: str = Field(default="http://localhost:8000")
    backend_host: str = Field(default="0.0.0.0")
    backend_port: int = Field(default=8000)

    # Pluggable Data & Catalog Paths
    data_dir: Path = Field(default=Path("../data"))
    hardware_catalog_path: Path = Field(default=Path("../data/catalogs/hardware_catalog.json"))
    oui_vendors_path: Path = Field(default=Path("../data/catalogs/oui_vendors.json"))
    iec62443_controls_path: Path = Field(default=Path("../data/catalogs/iec62443_controls.json"))
    benchmark_ground_truth_path: Path = Field(
        default=Path("../data/evals/benchmark_ground_truth.json")
    )

    @field_validator(
        "data_dir",
        "hardware_catalog_path",
        "oui_vendors_path",
        "iec62443_controls_path",
        "benchmark_ground_truth_path",
        mode="before",
    )
    @classmethod
    def _validate_and_resolve_path(cls, value: str | Path) -> Path:
        return _resolve_repo_or_backend_path(value)

    @property
    def resolved_data_dir(self) -> Path:
        return self.data_dir

    @property
    def resolved_hardware_catalog_path(self) -> Path:
        return self.hardware_catalog_path

    @property
    def resolved_oui_vendors_path(self) -> Path:
        return self.oui_vendors_path

    @property
    def resolved_iec62443_controls_path(self) -> Path:
        return self.iec62443_controls_path

    @property
    def resolved_benchmark_ground_truth_path(self) -> Path:
        return self.benchmark_ground_truth_path

    @property
    def scenarios_dir(self) -> Path:
        return (self.data_dir / "scenarios").resolve()

    @property
    def videos_dir(self) -> Path:
        return (self.data_dir / "videos").resolve()

    @property
    def visuals_dir(self) -> Path:
        return (self.data_dir / "visuals").resolve()

    @property
    def prompts_dir(self) -> Path:
        return (self.data_dir / "prompts").resolve()

    @property
    def real_ics_captures_dir(self) -> Path:
        return (self.data_dir / "real_ics_captures").resolve()

    @property
    def real_pcap_manifest_path(self) -> Path:
        return (self.real_ics_captures_dir / "REAL_PCAP_MANIFEST.json").resolve()

    @property
    def sam31_vision_prompts_path(self) -> Path:
        return (self.prompts_dir / "sam31_vision_prompts.json").resolve()

    @property
    def muse_spark_architect_prompt_path(self) -> Path:
        return (self.prompts_dir / "muse_spark_architect_prompt.md").resolve()

    @property
    def meta_api_configured(self) -> bool:
        return is_secret_configured(self.meta_model_api_key)

    @property
    def baseten_api_configured(self) -> bool:
        return is_secret_configured(self.baseten_api_key)

    @property
    def glimmer_endpoint_configured(self) -> bool:
        return bool(self.muse_glimmer_endpoint_url.strip())


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached singleton Settings instance."""
    return Settings()


settings = get_settings()
