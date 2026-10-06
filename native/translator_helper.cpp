#include <condition_variable>
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <mutex>
#include <optional>
#include <string>
#include <thread>

#include "conversation.h"
#include "engine.h"

namespace {

struct Job {
  long long id;
  unsigned long long generation;
  std::string text;
  std::string source;
  std::string target;
};

struct State {
  std::mutex mutex;
  std::condition_variable changed;
  std::optional<Job> queued;
  LiteRtLmConversation* active = nullptr;
  unsigned long long generation = 0;
  bool stopping = false;
};

std::mutex output_mutex;

std::string json_escape(const std::string& value) {
  std::string result;
  result.reserve(value.size() + 16);
  for (unsigned char c : value) {
    switch (c) {
      case '"': result += "\\\""; break;
      case '\\': result += "\\\\"; break;
      case '\b': result += "\\b"; break;
      case '\f': result += "\\f"; break;
      case '\n': result += "\\n"; break;
      case '\r': result += "\\r"; break;
      case '\t': result += "\\t"; break;
      default:
        if (c < 0x20) {
          const char* hex = "0123456789abcdef";
          result += "\\u00";
          result += hex[(c >> 4) & 0xf];
          result += hex[c & 0xf];
        } else {
          result += static_cast<char>(c);
        }
    }
  }
  return result;
}

void emit(const std::string& json) {
  std::lock_guard<std::mutex> lock(output_mutex);
  std::cout << json << '\n' << std::flush;
}

void emit_error(long long id, const std::string& message) {
  emit("{\"type\":\"result\",\"id\":" + std::to_string(id) +
       ",\"error\":\"" + json_escape(message) + "\"}");
}

std::optional<std::string> json_string(const std::string& json,
                                       const std::string& key) {
  const std::string marker = "\"" + key + "\"";
  size_t position = json.find(marker);
  if (position == std::string::npos) return std::nullopt;
  position = json.find(':', position + marker.size());
  if (position == std::string::npos) return std::nullopt;
  position = json.find('"', position + 1);
  if (position == std::string::npos) return std::nullopt;
  ++position;

  std::string result;
  while (position < json.size()) {
    char c = json[position++];
    if (c == '"') return result;
    if (c != '\\') {
      result += c;
      continue;
    }
    if (position >= json.size()) return std::nullopt;
    const char escaped = json[position++];
    switch (escaped) {
      case '"': result += '"'; break;
      case '\\': result += '\\'; break;
      case '/': result += '/'; break;
      case 'b': result += '\b'; break;
      case 'f': result += '\f'; break;
      case 'n': result += '\n'; break;
      case 'r': result += '\r'; break;
      case 't': result += '\t'; break;
      default: return std::nullopt;
    }
  }
  return std::nullopt;
}

std::optional<long long> json_integer(const std::string& json,
                                      const std::string& key) {
  const std::string marker = "\"" + key + "\"";
  size_t position = json.find(marker);
  if (position == std::string::npos) return std::nullopt;
  position = json.find(':', position + marker.size());
  if (position == std::string::npos) return std::nullopt;
  char* end = nullptr;
  const long long value = std::strtoll(json.c_str() + position + 1, &end, 10);
  if (end == json.c_str() + position + 1) return std::nullopt;
  return value;
}

LiteRtLmConversation* create_conversation(LiteRtLmEngine* engine,
                                           const Job& job) {
  LiteRtLmSessionConfig* session = litert_lm_session_config_create();
  if (!session) return nullptr;
  litert_lm_session_config_set_max_output_tokens(session, 40);

  LiteRtLmConversationConfig* config = litert_lm_conversation_config_create();
  if (!config) {
    litert_lm_session_config_delete(session);
    return nullptr;
  }
  litert_lm_conversation_config_set_session_config(config, session);
  const std::string instruction =
      "You are a precise music-lyrics translator. Translate from " + job.source +
      " to " + job.target +
      ". Preserve meaning, tone, names, punctuation, and line brevity. Return "
      "only the translated lyric, with no quotes, labels, notes, romanization, "
      "alternatives, or explanation.";
  const std::string system_message =
      "{\"role\":\"system\",\"content\":\"" +
      json_escape(instruction) + "\"}";
  litert_lm_conversation_config_set_system_message(config,
                                                    system_message.c_str());
  LiteRtLmThinkingConfig* thinking = litert_lm_thinking_config_create();
  if (thinking) {
    litert_lm_thinking_config_set_enable_thinking(thinking, false);
    litert_lm_conversation_config_set_thinking_config(config, thinking);
  }

  LiteRtLmConversation* conversation =
      litert_lm_conversation_create(engine, config);
  if (thinking) litert_lm_thinking_config_delete(thinking);
  litert_lm_conversation_config_delete(config);
  litert_lm_session_config_delete(session);
  return conversation;
}

void worker_loop(State& state, LiteRtLmEngine* engine) {
  while (true) {
    Job job;
    {
      std::unique_lock<std::mutex> lock(state.mutex);
      state.changed.wait(lock,
                         [&] { return state.stopping || state.queued.has_value(); });
      if (state.stopping) return;
      job = std::move(*state.queued);
      state.queued.reset();
    }

    LiteRtLmConversation* conversation = create_conversation(engine, job);
    if (!conversation) {
      emit_error(job.id, "Could not create a native translation conversation");
      continue;
    }
    {
      std::lock_guard<std::mutex> lock(state.mutex);
      if (job.generation != state.generation || state.stopping) {
        litert_lm_conversation_delete(conversation);
        continue;
      }
      state.active = conversation;
    }

    const std::string prompt =
        "Translate this music lyric from " + job.source + " to " + job.target +
        ". Return only the translation, without quotes or explanation:\n" +
        job.text;
    const std::string message =
        "{\"role\":\"user\",\"content\":\"" + json_escape(prompt) +
        "\"}";
    const auto started = std::chrono::steady_clock::now();
    LiteRtLmJsonResponse* response = litert_lm_conversation_send_message(
        conversation, message.c_str(), nullptr, nullptr);
    const auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                                std::chrono::steady_clock::now() - started)
                                .count();

    bool current;
    {
      std::lock_guard<std::mutex> lock(state.mutex);
      current = job.generation == state.generation && !state.stopping;
      if (state.active == conversation) state.active = nullptr;
    }

    if (current && response) {
      const char* response_json = litert_lm_json_response_get_string(response);
      if (response_json) {
        emit("{\"type\":\"result\",\"id\":" + std::to_string(job.id) +
             ",\"elapsedMs\":" + std::to_string(elapsed_ms) +
             ",\"response\":" + response_json + "}");
      } else {
        emit_error(job.id, "Native translator returned an empty response");
      }
    } else if (current) {
      emit_error(job.id, "Native translation failed");
    }
    if (response) litert_lm_json_response_delete(response);
    litert_lm_conversation_delete(conversation);
  }
}

std::string argument(int argc, char** argv, const std::string& name,
                     const std::string& fallback = "") {
  for (int index = 1; index + 1 < argc; ++index) {
    if (argv[index] == name) return argv[index + 1];
  }
  return fallback;
}

}  // namespace

int main(int argc, char** argv) {
  const std::string model_path = argument(argc, argv, "--model");
  const std::string backend = argument(argc, argv, "--backend", "gpu");
  const std::string cache_dir = argument(argc, argv, "--cache");
  if (model_path.empty()) {
    emit("{\"type\":\"fatal\",\"error\":\"Missing --model path\"}");
    return 2;
  }

  litert_lm_set_min_log_level(kLiteRtLmLogSeverityWarning);
  LiteRtLmEngineSettings* settings = litert_lm_engine_settings_create(
      model_path.c_str(), backend.c_str(), nullptr, nullptr);
  if (!settings) {
    emit("{\"type\":\"fatal\",\"error\":\"Could not create native engine settings\"}");
    return 3;
  }
  litert_lm_engine_settings_set_max_num_tokens(settings, 1024);
  if (!cache_dir.empty())
    litert_lm_engine_settings_set_cache_dir(settings, cache_dir.c_str());
  LiteRtLmEngine* engine = litert_lm_engine_create(settings);
  litert_lm_engine_settings_delete(settings);
  if (!engine) {
    emit("{\"type\":\"fatal\",\"error\":\"Could not load Gemma with the native GPU backend\"}");
    return 4;
  }

  State state;
  std::thread worker(worker_loop, std::ref(state), engine);
  emit("{\"type\":\"ready\",\"backend\":\"" + json_escape(backend) +
       "\"}");

  std::string line;
  while (std::getline(std::cin, line)) {
    const auto type = json_string(line, "type");
    if (!type) continue;
    if (*type == "shutdown") break;
    if (*type == "cancel") {
      std::lock_guard<std::mutex> lock(state.mutex);
      ++state.generation;
      state.queued.reset();
      if (state.active) litert_lm_conversation_cancel_process(state.active);
      continue;
    }
    if (*type != "translate") continue;
    const auto id = json_integer(line, "id");
    const auto text = json_string(line, "text");
    const auto source = json_string(line, "source");
    const auto target = json_string(line, "target");
    if (!id || !text || !source || !target) continue;
    {
      std::lock_guard<std::mutex> lock(state.mutex);
      ++state.generation;
      state.queued = Job{*id, state.generation, *text, *source, *target};
      if (state.active) litert_lm_conversation_cancel_process(state.active);
    }
    state.changed.notify_one();
  }

  {
    std::lock_guard<std::mutex> lock(state.mutex);
    state.stopping = true;
    ++state.generation;
    state.queued.reset();
    if (state.active) litert_lm_conversation_cancel_process(state.active);
  }
  state.changed.notify_one();
  worker.join();
  litert_lm_engine_delete(engine);
  return 0;
}
