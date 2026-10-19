import json
import re

import httpx

from .config import settings


class ProviderError(Exception):
	def __init__(self, message: str, status_code: int | None = None):
		super().__init__(message)
		self.status_code = status_code

class DemoProvider:
	async def complete_text(self, prompt: str, fallback: str) -> str:
		return fallback

	async def complete_json(self, prompt: str, fallback: dict) -> dict:
		return fallback


class GeminiProvider:
	async def complete_text(self, prompt: str, fallback: str) -> str:
		result = await self._request(prompt)
		if not result:
			raise ProviderError("Gemini returned an empty text response.")
		return result

	async def complete_json(self, prompt: str, fallback: dict) -> dict:
		result = await self._request(prompt, json_mode=True)
		if not result:
			raise ProviderError("Gemini returned an empty JSON response.")
		try:
			cleaned = result.strip().removeprefix("```json").removesuffix("```").strip()
			data = json.loads(cleaned)
		except (json.JSONDecodeError, TypeError) as error:
			raise ProviderError(f"Gemini returned invalid JSON: {error}") from error
		if not isinstance(data, dict):
			raise ProviderError("Gemini JSON response must be an object.")
		return data

	async def _request(self, prompt: str, json_mode: bool = False) -> str:
		if not settings.gemini_api_key:
			raise ProviderError("GEMINI_API_KEY is required when LLM_PROVIDER=gemini.")
		url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_model}:generateContent"
		payload = {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0.2}}
		if json_mode:
			payload["generationConfig"]["responseMimeType"] = "application/json"
		try:
			async with httpx.AsyncClient(timeout=45) as client:
				response = await client.post(url, params={"key": settings.gemini_api_key}, json=payload)
				if response.is_error:
					try:
						error_body = response.json().get("error", {})
					except (ValueError, AttributeError):
						error_body = {}
					reason = error_body.get("status")
					message = error_body.get("message")
					detail = ": ".join(str(part) for part in (reason, message) if part)
					if settings.gemini_api_key:
						detail = detail.replace(settings.gemini_api_key, "[redacted]")
					detail = re.sub(r"AIza[0-9A-Za-z_-]{20,}", "[redacted]", detail)
					suffix = f": {detail}" if detail else ""
					raise ProviderError(
						f"Gemini API request failed with HTTP {response.status_code}{suffix}",
						status_code=response.status_code,
					)
				text = response.json()["candidates"][0]["content"]["parts"][0]["text"]
				if not isinstance(text, str):
					raise ProviderError("Gemini response text was not a string.")
				return text
		except ProviderError:
			raise
		except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError, AttributeError) as error:
			raise ProviderError(f"Gemini API response was invalid: {type(error).__name__}") from error

def get_provider():
	mode = settings.llm_provider.strip().lower()
	if mode == "gemini":
		if not settings.gemini_api_key:
			raise ProviderError("GEMINI_API_KEY is required when LLM_PROVIDER=gemini.")
		return GeminiProvider()
	if mode == "demo":
		return DemoProvider()
	raise ProviderError(
		f"Unsupported LLM_PROVIDER '{settings.llm_provider}'. Choose 'gemini' or 'demo'."
	)
