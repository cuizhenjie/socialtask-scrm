package com.socialtask;

import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import com.fasterxml.jackson.databind.*;
import com.socialtask.common.Db;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

@EnabledIfEnvironmentVariable(named = "SUPABASE_URL", matches = ".+")
@SpringBootTest
@AutoConfigureMockMvc
class PeopleImportAndRetentionIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired Db db;

    private JsonNode req(MockHttpServletRequestBuilder b, int expect) throws Exception {
        MvcResult r = mvc.perform(b).andReturn();
        assertEquals(expect, r.getResponse().getStatus(), r.getResponse().getContentAsString());
        return mapper.readTree(r.getResponse().getContentAsString());
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder b, String token) {
        return b.header("Authorization", "Bearer " + token);
    }

    private String login(String user, String pass) throws Exception {
        return req(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of("username", user, "password", pass))), 200)
            .get("access_token").asText();
    }

    private static byte[] samplePng() throws Exception {
        BufferedImage img = new BufferedImage(4, 4, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(img, "png", out);
        return out.toByteArray();
    }

    @Test
    void bulkImportValidatesRowsWithoutOverwritingHistory() throws Exception {
        String admin = login("ci-admin", "This-Is-A-Test-Only-Password-123");
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String existingNo = "IMP_EX_" + suffix;
        req(auth(post("/api/v1/people"), admin).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of("personNo", existingNo, "name", "原始档案", "personType", "creator", "groupName", "第一组"))), 200);

        List<Map<String, Object>> rows = List.of(
            Map.of("personNo", "IMP_OK1_" + suffix, "name", "导入素人", "personType", "素人", "groupName", "第一组", "wecomUserId", "imp_wc_" + suffix),
            Map.of("personNo", existingNo, "name", "企图覆盖", "personType", "creator", "groupName", "第一组"),
            Map.of("personNo", "IMP_BAD_TYPE_" + suffix, "name", "非法角色", "personType", "hacker", "groupName", "第一组"),
            Map.of("personNo", "IMP_DUP_WC_" + suffix, "name", "企微冲突", "personType", "support", "groupName", "第一组", "wecomUserId", "imp_wc_" + suffix),
            Map.of("personNo", "IMP_BAD_GRP_" + suffix, "name", "无效分组", "personType", "assistant", "groupName", "不存在的组_" + suffix)
        );
        JsonNode result = req(auth(post("/api/v1/people/import"), admin).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of("rows", rows))), 200);

        assertEquals(5, result.get("total").asInt());
        assertEquals(1, result.get("imported_count").asInt());
        assertEquals(4, result.get("failed_count").asInt());
        assertEquals("IMP_OK1_" + suffix, result.get("imported").get(0).get("person_no").asText());
        assertEquals(4, result.get("errors").size());

        // Existing record must remain untouched.
        var existing = db.one("SELECT name FROM people WHERE person_no=?", existingNo);
        assertEquals("原始档案", existing.get("name"));

        // Non-admin must be rejected with 403.
        long importedId = result.get("imported").get(0).get("id").asLong();
        req(auth(post("/api/v1/people/" + importedId + "/credentials"), admin).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of("username", "imp-user-" + suffix, "password", "Testing-Pass-2026!"))), 200);
        String worker = login("imp-user-" + suffix, "Testing-Pass-2026!");
        req(auth(post("/api/v1/people/import"), worker).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of("rows", List.of(Map.of("personNo", "X1", "name", "X", "personType", "creator"))))), 403);
    }

    @Test
    void expiredPrivateMessageAttachmentIsPurgedWhileKeepingMetadataAndContentAsset() throws Exception {
        String admin = login("ci-admin", "This-Is-A-Test-Only-Password-123");
        byte[] png = samplePng();

        JsonNode pm = req(auth(multipart("/api/v1/attachments")
            .file(new MockMultipartFile("file", "pm.png", "image/png", png))
            .param("purpose", "PRIVATE_MESSAGE"), admin), 200);
        long pmId = pm.get("id").asLong();
        assertNotNull(pm.get("retention_until"));

        JsonNode content = req(auth(multipart("/api/v1/attachments")
            .file(new MockMultipartFile("file", "material.png", "image/png", png))
            .param("purpose", "CONTENT"), admin), 200);
        long contentId = content.get("id").asLong();
        assertNull(content.get("retention_until"));

        // Mark private message attachment as expired and run ops tick.
        db.execute("UPDATE attachments SET retention_until=(now() - INTERVAL '1 minute') WHERE id=?", pmId);
        JsonNode tick = req(auth(post("/api/v1/ops/tick"), admin), 200);
        assertTrue(tick.get("attachments").get("purged").asInt() >= 1);

        // Purged attachment returns 410, metadata row still exists for FK/audit integrity.
        MvcResult purgedDownload = mvc.perform(auth(get("/api/v1/attachments/" + pmId), admin)).andReturn();
        assertEquals(410, purgedDownload.getResponse().getStatus());
        var meta = db.one("SELECT purged_at, file_size FROM attachments WHERE id=?", pmId);
        assertNotNull(meta.get("purged_at"));
        assertEquals(0L, ((Number) meta.get("file_size")).longValue());

        // Unexpired content asset remains downloadable.
        MvcResult contentDownload = mvc.perform(auth(get("/api/v1/attachments/" + contentId), admin)).andReturn();
        assertEquals(200, contentDownload.getResponse().getStatus());
    }
}
