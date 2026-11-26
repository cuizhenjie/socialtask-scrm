package com.socialtask.task;

import com.socialtask.common.ApiException;
import org.junit.jupiter.api.Test;

import java.util.*;

import static com.socialtask.task.TicketTemplate.Kind.*;
import static com.socialtask.task.TicketTemplate.Phase.*;
import static org.junit.jupiter.api.Assertions.*;

class TicketTemplateTest {
    private static TicketTemplate.Field f(String key, TicketTemplate.Phase phase, TicketTemplate.Kind kind, boolean required){
        return new TicketTemplate.Field(key,key,phase,kind,required);
    }
    private static TicketTemplate template(int version, List<TicketTemplate.Field> fields) {
        return new TicketTemplate("dispatch",version,"下发工单",fields);
    }
    private static TicketTemplate.Material materials(long id) {
        return new TicketTemplate.Material(id,"图文包","指引","#活动",List.of(71L,72L));
    }
    private static void bad(Runnable r) { assertEquals(400,assertThrows(ApiException.class,r::run).status); }

    @Test void resolvesApprovedPackageAndChecksRequiredDispatchFields(){
        var t=template(1,List.of(f("instruction",DISPATCH,TEXT,true), f("assets",DISPATCH,MATERIAL_PACKAGE,true)));
        var snapshot=t.dispatch(Map.of("assets",19,"instruction"," 下载后执行 "),TicketTemplateTest::materials);
        assertEquals("下载后执行",snapshot.values().get("instruction"));
        assertEquals(materials(19),snapshot.values().get("assets"));
        assertEquals(Set.of(71L,72L),snapshot.assetIds());
        bad(()->t.dispatch(Map.of("assets",19),TicketTemplateTest::materials));
        bad(()->t.dispatch(Map.of("instruction","下载","assets",19),id->null));
        bad(()->t.dispatch(Map.of("instruction","下载","assets",Map.of("assetIds",List.of(999))),TicketTemplateTest::materials));
        bad(()->t.dispatch(Map.of("instruction","下载","assets",19.5),TicketTemplateTest::materials));
    }

    @Test void responseAllowsFalseAndValidatesOnlyConfiguredPhaseAndTypes(){
        var t=template(1,List.of(f("assets",DISPATCH,MATERIAL_PACKAGE,false),f("result_url",RESPONSE,HTTPS_URL,true),f("completed",RESPONSE,CHECKBOX,true)));
        assertEquals(Map.of("result_url","https://example.org/work","completed",false),t.response(Map.of("result_url","https://example.org/work","completed",false)));
        bad(()->t.response(Map.of("completed",true)));
        bad(()->t.response(Map.of("result_url","http://example.org/work","completed",false)));
        bad(()->t.response(Map.of("result_url","https://user@example.org/work","completed",false)));
        bad(()->t.response(Map.of("result_url","https://example.org/work","completed","false")));
        bad(()->t.response(Map.of("result_url","https://example.org/work","completed",true,"assets",1)));
        bad(()->t.dispatch(Map.of("completed",true),TicketTemplateTest::materials));
    }

    @Test void publishingNewRevisionCannotChangeOldTicketSnapshotOrItsValidation(){
        var fields=new ArrayList<>(List.of(f("assets",DISPATCH,MATERIAL_PACKAGE,true),f("old_result",RESPONSE,TEXT,true)));
        var v1=template(1,fields);
        var refs=new ArrayList<>(List.of(71L,72L));
        var input=new HashMap<String,Object>(Map.of("assets",19));
        var old=v1.dispatch(input,id->new TicketTemplate.Material(id,"原素材","原正文","",refs));
        refs.clear(); input.clear(); fields.set(1,f("new_result",RESPONSE,TEXT,true));
        var v2=template(2,fields);
        var fresh=v2.dispatch(Map.of("assets",20),TicketTemplateTest::materials);
        assertEquals(1,old.template().version());
        assertEquals("原素材",((TicketTemplate.Material)old.values().get("assets")).title());
        assertEquals(Set.of(71L,72L),old.assetIds());
        assertEquals(2,fresh.template().version());
        assertEquals(Map.of("old_result","旧工单"),old.template().response(Map.of("old_result","旧工单")));
        bad(()->fresh.template().response(Map.of("old_result","旧工单")));
        assertThrows(UnsupportedOperationException.class,()->old.values().clear());
        assertThrows(UnsupportedOperationException.class,()->old.template().fields().clear());
    }

    @Test void rejectsAmbiguousSchemaAndMaterialOutsideDispatch(){
        bad(()->template(1,List.of(f("same",DISPATCH,TEXT,true),f("same",RESPONSE,TEXT,false))));
        bad(()->template(1,List.of(f("file",RESPONSE,MATERIAL_PACKAGE,false))));
        bad(()->template(1,List.of(f("bad-key",RESPONSE,TEXT,false))));
        bad(()->template(0,List.of(f("text",RESPONSE,TEXT,false))));
    }
}
