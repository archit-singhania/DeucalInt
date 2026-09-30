package io.deucalint.sdk;

import static org.junit.jupiter.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class DeliveryTest {

  @Test
  void retryPreservesIdAndDrainsAcknowledgedBatch() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    var calls = new AtomicInteger();
    var payloads = new ArrayList<String>();
    server.createContext("/v1/batch", exchange -> {
      payloads.add(new String(exchange.getRequestBody().readAllBytes()));
      exchange.sendResponseHeaders(calls.incrementAndGet() == 1 ? 503 : 202, -1);
      exchange.close();
    });
    server.start();
    try {
      var sdk = new DeucalInt("http://127.0.0.1:" + server.getAddress().getPort(), "pk_test");
      sdk.track("purchase_completed", "visitor", Map.of("amount", 49));
      assertThrows(IllegalStateException.class, sdk::flush);
      sdk.flush();
      sdk.flush();
      assertEquals(2, payloads.size());
      assertEquals(payloads.get(0), payloads.get(1));
    } finally {
      server.stop(0);
    }
  }
}
