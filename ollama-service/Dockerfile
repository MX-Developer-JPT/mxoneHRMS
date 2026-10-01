# Standalone Ollama service — split out from the main app container so a
# crash or memory spike in the AI/LLM runtime can never take down the
# Express API that login/attendance/everything else depends on (the two
# used to share one container, one PID 1, one memory budget — see
# backend/start.sh history).
FROM ollama/ollama:latest

COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 11434

# The base image sets ENTRYPOINT ["/bin/ollama"] with CMD ["serve"] — reset
# the entrypoint so our start.sh runs directly instead of being passed to
# `ollama` as an argument (which would try to run `ollama /start.sh`).
ENTRYPOINT []
CMD ["/start.sh"]
