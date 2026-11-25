import javax.tools.*;
import com.sun.source.util.JavacTask;
import java.io.*;
import java.util.*;

/** Parse-only Java syntax validator. No external jars; never substitutes for Maven compilation. */
public class CheckJavaSyntax {
  public static void main(String[] args)throws Exception{
    var compiler=ToolProvider.getSystemJavaCompiler();
    var diagnostics=new DiagnosticCollector<JavaFileObject>();
    try(StandardJavaFileManager files=compiler.getStandardFileManager(diagnostics,null,null)){
      List<File> sources=new ArrayList<>();
      for(String path:args) sources.add(new File(path));
      var units=files.getJavaFileObjectsFromFiles(sources);
      var task=(JavacTask) compiler.getTask(new StringWriter(),files,diagnostics,List.of("-proc:none"),null,units);
      int parsed=0;for(var tree:task.parse()) parsed++;
      int errors=0;
      for(var d:diagnostics.getDiagnostics()) if(d.getKind()==Diagnostic.Kind.ERROR){errors++;System.err.println(d);}
      System.out.printf("%s: Java source parser checked %d files; syntax errors=%d%n",errors>0?"FAIL":"PASS",parsed,errors);
      if(errors>0||parsed!=sources.size())System.exit(1);
    }
  }
}
