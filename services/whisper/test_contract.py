import unittest
from contract import (
    MAX_PCM_BYTES,
    authorized,
    transcript_response,
    valid_pcm_length,
)


class RequestContractTests(unittest.TestCase):
    def test_only_explicit_bearer_token_is_accepted(self):
        token = "t" * 32
        self.assertTrue(authorized("Bearer " + token, token))
        self.assertFalse(authorized("Bearer " + "x" * 32, token))
        self.assertFalse(authorized("Basic " + token, token))
        self.assertFalse(authorized("Bearer " + token, "too-short"))

    def test_audio_is_bounded_aligned_and_nonempty(self):
        self.assertEqual(valid_pcm_length("96000"), 96000)
        self.assertEqual(valid_pcm_length(str(MAX_PCM_BYTES)), MAX_PCM_BYTES)
        for raw in ["0", "1", "-1", "3", "Infinity", "hello", None, str(MAX_PCM_BYTES + 2)]:
            self.assertIsNone(valid_pcm_length(raw))

    def test_response_removes_whitespace_and_bounds_size(self):
        content = transcript_response(" こんにちは " + "x" * 10000)
        import json

        parsed = json.loads(content)
        self.assertTrue(parsed["text"].startswith("こんにちは"))
        self.assertEqual(len(parsed["text"]), 4000)


if __name__ == "__main__":
    unittest.main()
