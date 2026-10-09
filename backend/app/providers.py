import json
import re

import httpx

from .config import settings


class ProviderError(Exception):
	pass

class DemoProvider:
	async def complete_text(self, prompt: str, fallback: str) -> str:
		return fallback

	async def complete_json(self, prompt: str, fallback: dict) -> dict:
		return fallback


class GeminiProvider:
	async def complete_text(self, prompt: str, fallback: str) -> str:
		result = await self._request(prompt)
		return result or fallback

	async def complete_json(self, prompt: str, fallback: dict) -> dict:
		result = await self._request(prompt, json_mode=True)
		if not result:
			return fallback
		try:
			cleaned = result.strip().removeprefix("```json").removesuffix("```").strip()
			return json.loads(cleaned)
		except (json.JSONDecodeError, TypeError):
			return fallback

	async def _request(self, prompt: str, json_mode: bool = False) -> str | None:
		if not settings.gemini_api_key:
			return None
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
						f"Hosted provider request failed with HTTP {response.status_code}{suffix}"
					)
				return response.json()["candidates"][0]["content"]["parts"][0]["text"]
		except ProviderError:
			raise
		except (httpx.HTTPError, KeyError, IndexError, TypeError) as error:
			raise ProviderError(f"Hosted provider response was invalid: {type(error).__name__}") from error

def get_provider():
	if settings.llm_provider.lower() == "gemini" and settings.gemini_api_key:
		return GeminiProvider()
	return DemoProvider()
