"""Real SDK transport contract checks; responses are mocks, not model quality tests."""
import json
import unittest
from unittest.mock import patch
import httpx
from ollama import AsyncClient
from local_agents import FunctionTool, MeteredOllamaClient, run_packet


class FrameworkContract(unittest.IsolatedAsyncioTestCase):
    async def fact_response(self, packet, response, inspect=None, raw_text=None):
        requests = []
        def handler(request):
            payload = json.loads(request.content)
            requests.append(payload)
            self.assertIs(payload["think"], False)
            self.assertIsInstance(payload["format"], dict)
            if inspect:
                inspect(payload)
            return httpx.Response(200, json={"model": "qwen3:4b", "done": True, "done_reason": "stop",
                "prompt_eval_count": 10, "eval_count": 5,
                "message": {"role": "assistant", "content": json.dumps(response) if raw_text is None else raw_text}})
        native = AsyncClient(host="http://127.0.0.1:11434", transport=httpx.MockTransport(handler))
        try:
            result = await run_packet(packet, MeteredOllamaClient(model="qwen3:4b", client=native))
            self.assertEqual(len(requests), 1)
            self.assertEqual(result["modelCalls"], 1)
            self.assertEqual(result["usageReportedCalls"], 1)
            self.assertEqual(result["usage"], {"promptTokens": 10, "completionTokens": 5})
            return result
        finally:
            await native._client.aclose()

    async def test_fact_tool_selector_invokes_actual_sdk_tools_with_empty_arguments(self):
        invoked = []
        original = FunctionTool.invoke
        async def record(tool, *args, **kwargs):
            self.assertEqual(kwargs["arguments"], {})
            self.assertTrue(kwargs["skip_parsing"])
            value = await original(tool, *args, **kwargs)
            invoked.append((tool.name, value))
            return value
        outputs = {"get_event_sequence": {"events": [{"id": "shot"}], "references": []},
            "score_at_moment": {"score": {"home": 1, "away": 1}, "references": []},
            "get_match_patterns": {"analysis": {"window": [0, 28]}, "references": []},
            "get_position_samples": {"positions": [], "references": []}}
        def inspect(payload):
            data = json.loads(payload["messages"][-1]["content"])
            self.assertEqual(set(data["availableTools"]), {"get_event_sequence", "score_at_moment", "get_match_patterns"})
            self.assertEqual(data["preferences"]["favoriteClub"], "away")
        with patch.object(FunctionTool, "invoke", record):
            result = await self.fact_response({"mode": "fact-tool-selector", "scope": {"anchorId": "shot"},
                "audience": "analyst", "preferences": {"favoriteClub": "away"}, "outputs": outputs},
                {"tools": ["get_event_sequence", "get_match_patterns", "score_at_moment"]}, inspect)
        self.assertEqual(result["tools"], ["get_event_sequence", "get_match_patterns", "score_at_moment"])
        self.assertEqual(result["raw"], {"tools": result["tools"]})
        self.assertEqual(invoked, [(name, outputs[name]) for name in result["tools"]])
        self.assertEqual([item["name"] for item in result["trace"]], result["tools"])

    async def test_fact_selector_rejects_missing_mandatory_duplicate_unknown_and_extra_output(self):
        packet = {"mode": "fact-tool-selector", "outputs": {
            "get_event_sequence": {"references": []}, "score_at_moment": {"references": []}}}
        for response in [{"tools": ["score_at_moment"]}, {"tools": ["get_event_sequence", "get_event_sequence"]},
                {"tools": ["get_event_sequence", "get_position_samples"]}, {"tools": ["get_event_sequence"], "text": "prose"}]:
            with self.subTest(response=response), self.assertRaises(RuntimeError):
                await self.fact_response(packet, response)

    async def test_compact_fact_slot_selection_and_editorial_review_are_separate_sdk_calls(self):
        catalog = {"facts": [{"slot": 1, "kind": "moment", "values": {"anchorId": "goal"}},
            {"slot": 2, "kind": "goal-score-change", "values": {"effect": "equalized"}},
            {"slot": 3, "kind": "recovery-before-shot", "values": {"seconds": 8}}]}
        scope = {"anchorId": "goal", "eventTime": 178, "observedAt": 180}
        def inspect_selection(payload):
            content = json.loads(payload["messages"][-1]["content"])
            self.assertEqual(content["catalog"], catalog)
            self.assertEqual(content["maximum"], 3)
            self.assertEqual(content["issues"], ["Prefer goal meaning over geometry."])
            self.assertEqual(payload["format"]["properties"]["slots"]["items"]["enum"], [1, 2, 3])
        selection = await self.fact_response({"mode": "fact-selection", "catalog": catalog, "maximum": 3,
            "scope": scope, "audience": "newcomer", "language": {"code": "en", "name": "English"},
            "issues": ["Prefer goal meaning over geometry."]}, {"slots": [1, 2, 3]}, inspect_selection)
        self.assertEqual(selection["raw"], {"slots": [1, 2, 3]})
        self.assertEqual(selection["tools"], [])
        claims = [{"text": "Canonical recorded score change.", "evidence": [{"id": "goal", "revision": 1}]}]
        def inspect_review(payload):
            content = json.loads(payload["messages"][-1]["content"])
            self.assertEqual(content["renderedClaims"], claims)
            self.assertEqual(content["selectedSlots"], [1, 2, 3])
            self.assertIn("do not certify free prose", payload["messages"][0]["content"])
        review = await self.fact_response({"mode": "fact-editorial-review", "catalog": catalog, "scope": scope,
            "audience": "newcomer", "renderedClaims": claims, "selectedSlots": [1, 2, 3]},
            {"decision": "revise", "issues": ["Omit redundant context."]}, inspect_review)
        self.assertEqual(review["raw"], {"decision": "revise", "issues": ["Omit redundant context."]})
        self.assertEqual(review["tools"], [])

    async def test_recap_selection_and_review_use_segment_scope_without_a_fake_anchor(self):
        catalog = {"facts": [{"slot": 1, "kind": "recap-overview", "values": {"home": 2, "away": 1}},
            {"slot": 2, "kind": "recap-goal-change", "values": {"time": 178, "effect": "equalized"}}]}
        scope = {"task": "recap", "observedAt": 362, "fixture": {"kind": "extended", "segmentDuration": 360}}
        def inspect(payload):
            content = json.loads(payload["messages"][-1]["content"])
            self.assertEqual(content["task"], "recap")
            self.assertNotIn("contextRequirement", content)
            self.assertEqual(content["scope"], scope)
            self.assertEqual(content["requiredSlots"], [1, 2])
            self.assertNotIn("anchorId", content["scope"])
            instruction = payload["messages"][0]["content"]
            self.assertIn("recap-overview slot must be first", instruction)
            self.assertIn("not a full match", instruction)
            self.assertIn("chronological", instruction)
        base = {"task": "recap", "catalog": catalog, "scope": scope, "audience": "newcomer", "maximum": 3, "requiredSlots": [1, 2]}
        selection = await self.fact_response({**base, "mode": "fact-selection"}, {"slots": [1, 2]}, inspect)
        self.assertEqual(selection["tools"], [])
        review = await self.fact_response({**base, "mode": "fact-editorial-review", "selectedSlots": [1, 2],
            "audienceSelectionRule": {"code": "player-focus-missing", "playerFactSlot": None, "player": None, "blocking": False},
            "renderedClaims": [{"text": "A synthetic segment recap.", "evidence": []}]},
            {"decision": "approve", "issues": [], "suggestions": []}, inspect)
        self.assertEqual(review["raw"], {"decision": "approve", "issues": [], "suggestions": []})
        with self.assertRaises(RuntimeError):
            await self.fact_response({**base, "mode": "fact-selection", "task": "invent"}, {"slots": [1]},
                lambda payload: self.fail("Unknown task must fail before a request."))

    async def test_recap_capacity_contract_survives_sdk_selection_and_jointly_feasible_review(self):
        catalog = {"facts": [
            {"slot": 1, "kind": "recap-overview", "values": {"home": 2, "away": 1}},
            {"slot": 2, "kind": "recap-goal-score-change", "values": {"time": 178, "effect": "equalized"}},
            {"slot": 3, "kind": "recap-goal-score-change", "values": {"time": 328, "effect": "took-lead"}},
            {"slot": 4, "kind": "recap-team-shots", "values": {"team": "home", "count": 2}},
            {"slot": 5, "kind": "recap-team-shots", "values": {"team": "away", "count": 5}}]}
        capacity = {"maximumFacts": 3, "mandatoryFactCount": 2, "optionalFactCapacity": 1}
        base = {"task": "recap", "catalog": catalog, "maximum": 3, "audience": "newcomer",
                "requiredSlots": [3], "mandatorySlots": [1, 3], "selectionCapacity": capacity,
                "scope": {"task": "recap", "observedAt": 362}}
        saved = json.loads(json.dumps(base))
        def inspect(payload):
            content = json.loads(payload["messages"][-1]["content"])
            self.assertEqual(content["selectionCapacity"], capacity)
            self.assertEqual(content["mandatorySlots"], [1, 3])
            self.assertEqual(content["requiredSlots"], [3])
            instruction = payload["messages"][0]["content"]
            self.assertIn("recent supported equalizer", instruction)
            self.assertIn("optionalFactCapacity", instruction)
            self.assertIn("Do not demand complete goal history", instruction)
        selected = await self.fact_response({**base, "mode": "fact-selection"}, {"slots": [1, 2, 3]}, inspect)
        self.assertEqual(selected["raw"], {"slots": [1, 2, 3]})
        def inspect_review(payload):
            inspect(payload)
            instruction = payload["messages"][0]["content"]
            self.assertIn("jointly feasible", instruction)
            self.assertIn("exactly one structured player-focus-missing issue", instruction)
            self.assertIn("immutable template wording", instruction)
            self.assertIn("team-count balance", instruction)
        await self.fact_response({**base, "mode": "fact-editorial-review", "selectedSlots": [1, 4, 3],
            "audienceSelectionRule": {"code": "player-focus-missing", "playerFactSlot": None, "player": None, "blocking": False},
            "renderedClaims": [{"text": "Canonical recap", "evidence": []}]},
            {"decision": "approve", "issues": [], "suggestions": ["Consider the recent equalizer instead of shots."]}, inspect_review)
        self.assertEqual(base, saved)
        for change in [{"mandatorySlots": [1, 1]}, {"mandatorySlots": [1, 2]},
                {"selectionCapacity": {**capacity, "optionalFactCapacity": 2}},
                {"selectionCapacity": {**capacity, "mandatoryFactCount": True}}]:
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                await self.fact_response({**base, **change, "mode": "fact-selection"}, {"slots": [1, 2, 3]},
                    lambda payload: self.fail("Malformed capacity must fail before model transport."))

    async def test_objective_recap_review_uses_current_slots_and_keeps_style_suggestions_nonblocking(self):
        catalog = {"facts": [{"slot": 1, "kind": "recap-overview", "values": {}},
            {"slot": 2, "kind": "recap-team-shots", "values": {"team": "home", "count": 2}},
            {"slot": 3, "kind": "recap-player-actions", "values": {"player": "A. Reed"}}]}
        rule = {"code": "player-focus-missing", "playerFactSlot": 3, "player": "A. Reed", "blocking": True}
        packet = {"mode": "fact-editorial-review", "task": "recap", "catalog": catalog,
            "audience": "player", "preferences": {"favoritePlayer": "A. Reed"}, "maximum": 2,
            "mandatorySlots": [1], "requiredSlots": [1], "selectedSlots": [1, 2], "renderedClaims": [],
            "selectionCapacity": {"maximumFacts": 2, "mandatoryFactCount": 1, "optionalFactCapacity": 1},
            "audienceSelectionRule": rule}
        def inspect(payload):
            content = json.loads(payload["messages"][-1]["content"])
            self.assertEqual(content["audienceSelectionRule"], rule)
            schema = payload["format"]["anyOf"][1]
            self.assertEqual(schema["required"], ["decision", "issues", "suggestions"])
            issue = schema["properties"]["issues"]["items"]
            self.assertEqual(issue["properties"]["replacementSlot"]["enum"], [1, 2, 3])
            self.assertEqual(issue["properties"]["selectedSlot"]["anyOf"][1], {"type": "null"})
            self.assertEqual(issue["properties"]["code"]["const"], "player-focus-missing")
            instruction = payload["messages"][0]["content"]
            self.assertIn("only blocking issue", instruction)
            self.assertIn("nonblocking suggestions", instruction)
            self.assertIn("can never justify revise", instruction)
        verdict = {"decision": "revise", "issues": [{"code": "player-focus-missing", "selectedSlot": 2, "replacementSlot": 3}], "suggestions": []}
        self.assertEqual((await self.fact_response(packet, verdict, inspect))["raw"], verdict)
        suggestion = {"decision": "approve", "issues": [], "suggestions": ["Consider an equalizer highlight."]}
        self.assertEqual((await self.fact_response({**packet, "audience": "newcomer",
            "audienceSelectionRule": {**rule, "blocking": False}}, suggestion))["raw"], suggestion)
        malformed = {"decision": "revise", "issues": [{"code": "style", "replacementSlot": 99}], "suggestions": []}
        self.assertEqual((await self.fact_response(packet, malformed))["raw"], malformed)
        with self.assertRaises(RuntimeError):
            await self.fact_response({**packet, "audienceSelectionRule": {**rule, "playerFactSlot": 99}}, verdict,
                lambda payload: self.fail("Unknown objective-rule slots must fail before transport."))

    async def test_moment_goal_requirements_and_capacity_reach_both_sdk_phases(self):
        catalog = {"facts": [{"slot": 1, "kind": "moment", "values": {"outcome": "goal"}},
            {"slot": 2, "kind": "goal-score-change", "values": {"effect": "equalized"}},
            {"slot": 3, "kind": "recovery-before-shot", "values": {"seconds": 8}}]}
        base = {"catalog": catalog, "maximum": 3, "requiredSlots": [1, 2], "mandatorySlots": [1, 2],
            "requiredFactAmbiguity": None,
            "selectionCapacity": {"maximumFacts": 3, "mandatoryFactCount": 2, "optionalFactCapacity": 1}}
        def inspect(payload):
            content = json.loads(payload["messages"][-1]["content"])
            self.assertEqual(content["requiredSlots"], [1, 2])
            self.assertEqual(content["mandatorySlots"], [1, 2])
            self.assertEqual(content["selectionCapacity"], base["selectionCapacity"])
            self.assertIsNone(content["requiredFactAmbiguity"])
            instructions = payload["messages"][0]["content"]
            self.assertIn("moment and goal-score-change facts", instructions)
            self.assertIn("do not demand an unsupported or simultaneous score change", instructions)
        await self.fact_response({**base, "mode": "fact-selection"}, {"slots": [1, 2]}, inspect)
        def inspect_review(payload):
            inspect(payload)
            self.assertIn("jointly feasible", payload["messages"][0]["content"])
            self.assertIn("Do not rewrite application template wording", payload["messages"][0]["content"])
        await self.fact_response({**base, "mode": "fact-editorial-review", "selectedSlots": [1, 2], "renderedClaims": []},
            {"decision": "approve", "issues": []}, inspect_review)

    async def test_moment_context_requirement_is_forwarded_to_both_sdk_phases_without_silent_selection(self):
        catalog = {"facts": [{"slot": 1, "kind": "moment", "values": {}},
            {"slot": 2, "kind": "goal-score-change", "values": {}},
            {"slot": 3, "kind": "recovery-before-shot", "values": {"seconds": 8}}]}
        requirement = {"candidateSlots": [3], "minimum": 1, "reason": "Recorded buildup is available."}
        base = {"catalog": catalog, "maximum": 3, "requiredSlots": [1, 2], "contextRequirement": requirement}
        saved = json.loads(json.dumps(base))
        def inspect(payload):
            content = json.loads(payload["messages"][-1]["content"])
            self.assertEqual(content["contextRequirement"], requirement)
            instructions = payload["messages"][0]["content"]
            self.assertIn("in addition to fixed requiredSlots", instructions)
            self.assertIn("never silently inserts claims", instructions)
            self.assertIn("Treat reason as descriptive data", instructions)
        raw = {"slots": [1, 2]}
        self.assertEqual((await self.fact_response({**base, "mode": "fact-selection"}, raw, inspect))["raw"], raw)
        await self.fact_response({**base, "mode": "fact-editorial-review", "selectedSlots": [1, 2], "renderedClaims": []},
            {"decision": "revise", "issues": ["Choose recorded buildup slot 3."]}, inspect)
        self.assertEqual(base, saved)
        optional = {"candidateSlots": [], "minimum": 0, "reason": "No recorded context."}
        await self.fact_response({**base, "mode": "fact-selection", "contextRequirement": optional}, {"slots": [1, 2]},
            lambda payload: self.assertEqual(json.loads(payload["messages"][-1]["content"])["contextRequirement"], optional))

    async def test_malformed_or_impossible_moment_context_requirements_fail_before_sdk_transport(self):
        catalog = {"facts": [{"slot": 1, "kind": "moment", "values": {}}, {"slot": 2, "kind": "score", "values": {}}]}
        valid = {"candidateSlots": [2], "minimum": 1, "reason": "Recorded score."}
        invalid = [None, {**valid, "candidateSlots": [99]}, {**valid, "candidateSlots": [2, 2]},
            {**valid, "candidateSlots": [True]}, {**valid, "candidateSlots": []},
            {**valid, "candidateSlots": [1]}, {**valid, "minimum": 2}, {**valid, "minimum": True},
            {**valid, "reason": "x" * 201}, {**valid, "reason": ""}, {**valid, "token": "secret"}]
        for requirement in invalid:
            with self.subTest(requirement=requirement), self.assertRaises(RuntimeError):
                await self.fact_response({"mode": "fact-selection", "catalog": catalog, "maximum": 2,
                    "requiredSlots": [1], "contextRequirement": requirement}, {"slots": [1, 2]},
                    lambda payload: self.fail("Invalid context must fail before transport."))
        with self.assertRaises(RuntimeError):
            await self.fact_response({"mode": "fact-selection", "catalog": catalog, "maximum": 1,
                "requiredSlots": [1], "contextRequirement": valid}, {"slots": [1]},
                lambda payload: self.fail("Impossible capacity must fail before transport."))

    async def test_invalid_fact_slots_and_editorial_verdicts_reach_node_repair_without_extra_calls(self):
        catalog = {"facts": [{"slot": 1, "kind": "moment", "values": {"anchorId": "goal"}},
            {"slot": 2, "kind": "score", "values": {"home": 1, "away": 1}}]}
        packet = {"mode": "fact-selection", "catalog": catalog, "maximum": 2, "scope": {"anchorId": "goal"}}
        for response in [{"slots": [2, 1]}, {"slots": [1, 1]}, {"slots": [1, 9]}, {"slots": [True]},
                {"slots": [1], "text": "prose"}, {"slots": [1, 2, 3]}]:
            with self.subTest(response=response):
                result = await self.fact_response(packet, response)
                self.assertEqual(result["raw"], response)
                self.assertEqual(result["tools"], [])
        review_packet = {"mode": "fact-editorial-review", "catalog": catalog, "selectedSlots": [1], "renderedClaims": []}
        for response in [{"decision": "approve", "issues": ["Contradiction."]}, {"decision": "revise", "issues": []},
                {"decision": "approve", "issues": [], "text": "free prose"}]:
            with self.subTest(response=response):
                result = await self.fact_response(review_packet, response)
                self.assertEqual(result["raw"], response)
                self.assertEqual(result["tools"], [])
        for candidate in [None, [1, 2], "unstructured prose"]:
            result = await self.fact_response(packet, candidate)
            self.assertEqual(result["raw"], candidate)
        for phase in [packet, review_packet]:
            result = await self.fact_response(phase, None, raw_text='This is not JSON.')
            self.assertEqual(result["raw"], {"invalidJson": True})
            self.assertEqual(result["modelCalls"], 1)

    async def test_fact_selection_repair_preserves_reviewer_issues_and_previous_slots(self):
        catalog = {"facts": [{"slot": 1, "kind": "moment", "values": {"anchorId": "goal"}},
            {"slot": 2, "kind": "goal-score-change", "values": {"effect": "equalized"}},
            {"slot": 3, "kind": "player-sample-displacement-rate", "values": {"value": 1.7}}]}
        repair = {"issues": ["Replace distracting sample rate with goal score change."], "previousSlots": [1, 3]}
        packet = {"mode": "fact-selection", "catalog": catalog, "maximum": 3, "scope": {"anchorId": "goal"},
            "audience": "newcomer", "repair": repair}
        saved = json.loads(json.dumps(packet))
        def inspect(payload):
            content = json.loads(payload["messages"][-1]["content"])
            self.assertEqual(content["repair"], repair)
            self.assertIn("repair.issues", payload["messages"][0]["content"])
        result = await self.fact_response(packet, {"slots": [1, 2]}, inspect)
        self.assertEqual(result["raw"], {"slots": [1, 2]})
        self.assertEqual(packet, saved)
        packet["repair"] = {"issues": ["Earlier selection failed validation."], "previousSlots": []}
        await self.fact_response(packet, {"slots": [1, 2]}, lambda payload:
            self.assertEqual(json.loads(payload["messages"][-1]["content"])["repair"]["previousSlots"], []))
        for invalid in [{"issues": [], "previousSlots": [1]}, {"issues": ["x" * 501], "previousSlots": [1]},
                {"issues": ["issue"], "previousSlots": [1, 1]}, {"issues": ["issue"], "previousSlots": [9]},
                {"issues": ["issue"], "previousSlots": [True]}, {"issues": ["issue"], "previousSlots": [], "instruction": "invent prose"}]:
            packet["repair"] = invalid
            with self.subTest(repair=invalid), self.assertRaises(RuntimeError):
                await self.fact_response(packet, {"slots": [1]}, lambda payload:
                    self.fail("Malformed repair must be rejected before a model request."))

    async def test_available_pattern_tool_is_selected_invoked_and_reviewed(self):
        requests = []
        refs = [{"id": "recovery-1", "revision": 1, "type": "event"},
                {"id": "pass-1", "revision": 2, "type": "event"},
                {"id": "shot-1", "revision": 2, "type": "event"}]
        pattern = {"kind": "recovery-before-shot", "seconds": 8, "completedPasses": 1, "evidence": refs}
        output = {"references": refs, "patterns": [pattern], "window": {"start": 0, "end": 28}}
        claim = {"text": "A shot was recorded eight seconds after a recovery, with one completed pass between them.",
                 "evidence": [{"id": ref["id"], "revision": ref["revision"]} for ref in refs]}

        def handler(request):
            payload = json.loads(request.content)
            requests.append(payload)
            content = json.loads(payload["messages"][-1]["content"])
            if len(requests) == 1:
                self.assertEqual(set(content["availableTools"]), {"get_match_patterns"})
                self.assertEqual(payload["format"]["properties"]["tools"]["items"]["enum"], ["get_match_patterns"])
                self.assertIn("received-window", content["question"])
                response = {"tools": ["get_match_patterns"]}
            elif len(requests) == 2:
                self.assertEqual(content["evidence"]["get_match_patterns"], output)
                self.assertIn("temporal associations", payload["messages"][0]["content"])
                response = {"claims": [claim]}
            else:
                self.assertEqual(content["draft"]["claims"][0], claim)
                self.assertEqual(content["evidence"]["get_match_patterns"]["patterns"][0], pattern)
                self.assertIn("unknown", payload["messages"][0]["content"])
                response = {"decision": "approve", "issues": []}
            return httpx.Response(200, json={"model": "qwen3:4b", "done": True, "done_reason": "stop",
                "message": {"role": "assistant", "content": json.dumps(response)}})

        native = AsyncClient(host="http://127.0.0.1:11434", transport=httpx.MockTransport(handler))
        try:
            client = MeteredOllamaClient(model="qwen3:4b", client=native)
            result = await run_packet({"mode": "investigator-reviewer", "scope": {"observedAt": 32},
                "audience": "analyst", "question": "Explain the received-window recovery-to-shot sequence.",
                "language": {"code": "en", "name": "English"}, "outputs": {"get_match_patterns": output}}, client)
            self.assertEqual(result["tools"], ["get_match_patterns"])
            self.assertEqual(result["modelCalls"], 3)
            self.assertEqual(result["repairCount"], 0)
            self.assertEqual(result["review"], {"decision": "approve", "issues": []})
            self.assertEqual(result["draft"]["claims"], [claim])
        finally:
            await native._client.aclose()

    async def test_review_rejection_has_one_repair_handoff(self):
        requests = []
        ref = {"id": "event-1", "revision": 1, "type": "event"}
        outputs = {"references": [ref], "events": [{"id": "event-1", "type": "shot", "result": True}]}
        responses = [{"tools": ["get_event_sequence"]},
            {"claims": [{"text": "Unsupported explanation.", "evidence": [ref]}]},
            {"decision": "revise", "issues": ["Explanation unsupported."]},
            {"claims": [{"text": "A goal was recorded.", "evidence": [ref]}]},
            {"decision": "approve", "issues": []}]

        def handler(request):
            payload = json.loads(request.content)
            requests.append(payload)
            if len(requests) == 4:
                self.assertIn('Explanation unsupported.', payload["messages"][-1]["content"])
            return httpx.Response(200, json={"model": "qwen3:4b", "done": True, "done_reason": "stop",
                "message": {"role": "assistant", "content": json.dumps(responses[len(requests) - 1])}})

        native = AsyncClient(host="http://127.0.0.1:11434", transport=httpx.MockTransport(handler))
        client = MeteredOllamaClient(model="qwen3:4b", client=native)
        result = await run_packet({"mode": "investigator-reviewer", "scope": {"observedAt": 1},
            "audience": "newcomer", "language": {"code": "en", "name": "English"},
            "outputs": {"get_event_sequence": outputs}}, client)
        self.assertEqual(result["repairCount"], 1)
        self.assertEqual(result["modelCalls"], 5)
        self.assertEqual(result["tools"], ["get_event_sequence"])
        self.assertEqual(result["review"]["decision"], "approve")
        await native._client.aclose()

    async def test_structured_tool_selection_execution_review_and_usage(self):
        requests = []
        ref = {"id": "received-event", "revision": 2, "type": "event"}
        output = {"references": [ref], "events": [{"id": ref["id"], "revision": 2, "type": "shot", "result": True}]}

        def handler(request):
            payload = json.loads(request.content)
            requests.append(payload)
            if len(requests) == 1:
                message = {"role": "assistant", "content": json.dumps({"tools": ["get_event_sequence"]})}
            elif len(requests) == 2:
                self.assertIn('received-event', payload["messages"][-1]["content"])
                message = {"role": "assistant", "content": json.dumps({"claims": [
                    {"text": "A goal was recorded.", "evidence": [ref]}]})}
            else:
                message = {"role": "assistant", "content": json.dumps({"decision": "approve", "issues": []})}
            return httpx.Response(200, json={"model": "qwen3:4b", "message": message,
                "done": True, "done_reason": "stop", "prompt_eval_count": 10, "eval_count": 5})

        transport = httpx.MockTransport(handler)
        native = AsyncClient(host="http://127.0.0.1:11434", transport=transport)
        client = MeteredOllamaClient(model="qwen3:4b", client=native,
            function_invocation_configuration={"max_iterations": 4, "terminate_on_unknown_calls": True})
        result = await run_packet({"mode": "investigator-reviewer", "scope": {"observedAt": 10},
            "audience": "analyst", "language": {"code": "en", "name": "English"},
            "outputs": {name: output for name in ["get_event_sequence", "get_position_samples", "measure_moment", "score_at_moment"]}}, client)
        self.assertEqual(result["tools"], ["get_event_sequence"])
        self.assertEqual(result["review"]["decision"], "approve")
        self.assertEqual(result["modelCalls"], 3)
        self.assertEqual(result["usageReportedCalls"], 3)
        self.assertEqual(result["usage"], {"promptTokens": 30, "completionTokens": 15})
        self.assertTrue(all(request["think"] is False for request in requests))
        self.assertTrue(all(isinstance(request["format"], dict) for request in requests))
        await native._client.aclose()


if __name__ == "__main__":
    unittest.main()
