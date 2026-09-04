package com.taskflow;

import com.taskflow.controller.HealthController;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class HealthControllerTest {

    private final HealthController healthController = new HealthController();

    @Test
    void healthCheckReturnsStatusUp() {
        var response = healthController.healthCheck();
        assertNotNull(response);
        assertEquals("UP", response.get("status"));
        assertEquals("TaskFlow API", response.get("service"));
        assertNotNull(response.get("timestamp"));
    }
}
