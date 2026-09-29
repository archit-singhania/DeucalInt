package io.deucalint;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.kafka.KafkaContainer;
import org.testcontainers.utility.DockerImageName;
import org.apache.kafka.clients.producer.*;
import org.apache.kafka.clients.consumer.*;
import org.apache.kafka.common.serialization.*;
import java.time.Duration;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
@Testcontainers(disabledWithoutDocker=true)
class BrokerContainerTest {
    @Container static KafkaContainer kafka=new KafkaContainer(DockerImageName.parse("apache/kafka-native:3.9.1"));
    @Test void durableBrokerRoundTrip() throws Exception {
        Properties p=new Properties();p.put("bootstrap.servers",kafka.getBootstrapServers());p.put("key.serializer",StringSerializer.class);p.put("value.serializer",StringSerializer.class);p.put("acks","all");
        try(var producer=new KafkaProducer<String,String>(p)){producer.send(new ProducerRecord<>("analytics.events.raw","project:visitor","event-1")).get();}
        Properties c=new Properties();c.put("bootstrap.servers",kafka.getBootstrapServers());c.put("key.deserializer",StringDeserializer.class);c.put("value.deserializer",StringDeserializer.class);c.put("group.id",UUID.randomUUID().toString());c.put("auto.offset.reset","earliest");
        try(var consumer=new KafkaConsumer<String,String>(c)){consumer.subscribe(List.of("analytics.events.raw"));long deadline=System.currentTimeMillis()+20000;String value=null;while(value==null&&System.currentTimeMillis()<deadline){for(var record:consumer.poll(Duration.ofSeconds(1)))value=record.value();}assertEquals("event-1",value);}
    }
}
