package io.deucalint;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import static org.junit.jupiter.api.Assertions.*;
class ContractTest {
    String event(){return "{\"eventId\":\"e\",\"schemaVersion\":1,\"type\":\"product\",\"name\":\"checkout\",\"timestamp\":\""+Instant.now()+"\",\"anonymousId\":\"a\",\"sessionId\":\"s\",\"properties\":{\"password\":\"secret\",\"nested\":{\"email\":\"a@example.com\"}}}";}
    @Test void scrubsBeforeBroker() throws Exception{var out=Platform.validate(Platform.JSON.readTree(event()));assertEquals("[redacted]",out.path("properties").path("password").asText());assertFalse(out.toString().contains("a@example.com"));}
    @Test void rejectsTenantSpoofing() throws Exception{var e=Platform.JSON.readTree(event());((com.fasterxml.jackson.databind.node.ObjectNode)e).put("projectId","other");assertThrows(IllegalArgumentException.class,()->Platform.validate(e));}
    @Test void requiresIdentity() throws Exception{var e=Platform.JSON.readTree(event());((com.fasterxml.jackson.databind.node.ObjectNode)e).remove("sessionId");assertThrows(IllegalArgumentException.class,()->Platform.validate(e));}
}
